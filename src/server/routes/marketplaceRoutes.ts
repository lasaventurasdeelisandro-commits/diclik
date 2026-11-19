import { isQuickAccessCategory } from "../../quickAccess.ts";
import { commissionBasisPoints, commissionInCents } from "../../commission.ts";
import { Router, Request, Response } from "express";
import crypto from "crypto";
import { db } from "../db/index.ts";
import { requireAuth, requireRole, AuthenticatedRequest, optionalUser } from "../middleware/auth.ts";

export const marketplaceRouter = Router();

// Per-contract OTP brute-force protection (max 5 failed tries / 10 min)
const otpAttempts = new Map<string, { count: number; resetAt: number }>();

function checkOtpRateLimit(contractId: string): boolean {
  const now = Date.now();
  const entry = otpAttempts.get(contractId);
  if (!entry || entry.resetAt <= now) {
    return true;
  }
  return entry.count < 5;
}

function recordFailedOtpAttempt(contractId: string): void {
  const now = Date.now();
  const entry = otpAttempts.get(contractId);
  if (!entry || entry.resetAt <= now) {
    otpAttempts.set(contractId, { count: 1, resetAt: now + 10 * 60 * 1000 });
  } else {
    entry.count += 1;
  }
}

async function requireIdentity(req: AuthenticatedRequest, res: Response, next: import("express").NextFunction) {
  if (req.user!.role === "admin") {
    next();
    return;
  }
  try {
    const identity = await db.query("SELECT 1 FROM identity_documents WHERE user_id = $1", [req.user!.id]);
    if (!identity.rows.length) {
      res.status(403).json({ code: "IDENTITY_REQUIRED", error: "Sube tu cédula o identificación en Cuenta para continuar." });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}

function validServicePhoto(value: unknown): boolean {
  if (typeof value !== "string" || value.length > 226_700) return false;
  const match = /^data:image\/(jpeg|png|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return false;
  const [, format, data] = match;
  const bytes = Buffer.from(data, "base64");
  if (bytes.length > 170_000 || bytes.toString("base64") !== data) return false;
  if (format === "jpeg") return bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  if (format === "png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (format === "gif") return ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"));
  return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
}

// GET /api/v1/categories (Active official categories)
marketplaceRouter.get("/categories", async (_req: Request, res: Response) => {
  try {
    const result = await db.query(
      "SELECT id, name, slug, icon, description, base_min_price FROM service_categories WHERE is_active = TRUE ORDER BY name ASC;"
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: "Error al consultar categorías de servicios" });
  }
});

// GET /api/v1/services (List service requests without exposing PII or private OTP codes)
marketplaceRouter.get("/services", async (req: Request, res: Response) => {
  try {
    const caller = await optionalUser(req);
    const { category, targetRole, status, clientId } = req.query;
    let query = `
      SELECT sr.id, sr.client_id, sr.category_id, sr.target_role, sr.title, sr.description,
             sr.address, sr.lat, sr.lng, sr.urgency, sr.budget_strategy, sr.min_budget,
             sr.status, sr.accepted_offer_id, sr.photos, sr.created_at, sr.updated_at,
             u.full_name as client_name, u.avatar_url as client_avatar, u.phone as client_phone,
             sc.name as category_name, sc.icon as category_icon,
             (SELECT COUNT(*) FROM offers o WHERE o.request_id = sr.id) as offer_count
      FROM service_requests sr
      JOIN users u ON sr.client_id = u.id
      LEFT JOIN service_categories sc ON sr.category_id = sc.id
      WHERE 1=1
    `;
    const params: any[] = [];
    if (caller?.role !== "admin") {
      if (caller?.id) {
        params.push(caller.id);
        query += ` AND (sr.preferred_professional_id IS NULL OR sr.preferred_professional_id = $1 OR sr.client_id = $1)`;
      } else {
        query += " AND sr.preferred_professional_id IS NULL";
      }
    }

    if (category && category !== "todas") {
      params.push(category);
      query += ` AND (sr.category_id = $${params.length} OR sc.slug = $${params.length})`;
    }

    if (targetRole) {
      params.push(targetRole);
      query += ` AND sr.target_role = $${params.length}`;
    }

    if (status) {
      params.push(status);
      query += ` AND sr.status = $${params.length}`;
    }

    if (clientId) {
      params.push(clientId);
      query += ` AND sr.client_id = $${params.length}`;
    }

    query += " ORDER BY sr.created_at DESC LIMIT 50;";

    const result = await db.query(query, params);
    const sanitized = result.rows.map((row: any) => {
      const canSeePhone = caller && (caller.role === "admin" || caller.id === row.client_id);
      return {
        ...row,
        client_phone: canSeePhone ? row.client_phone : null,
        address: canSeePhone ? row.address : null,
        lat: canSeePhone ? row.lat : null,
        lng: canSeePhone ? row.lng : null,
        photos: caller ? row.photos : []
      };
    });

    res.json(sanitized);
  } catch {
    res.status(500).json({ error: "Error al consultar solicitudes de servicio" });
  }
});

// POST /api/v1/services (Client creates service request)
marketplaceRouter.post("/services", requireAuth, requireIdentity, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const { title, description, categoryId, targetRole, address, lat, lng, urgency, budgetStrategy, minBudget, photos, preferredSpecialistId, sponsoredCategory } = req.body;

    if (photos != null && (!Array.isArray(photos) || photos.length > 8 || !photos.every(validServicePhoto))) {
      res.status(400).json({ error: "Adjunta hasta ocho fotos válidas. Si alguna no se puede preparar, vuelve a seleccionarla." });
      return;
    }

    if ((lat != null || lng != null) &&
        (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)) {
      res.status(400).json({ error: "Selecciona un punto válido en el mapa." });
      return;
    }

    if (!title || !description || !address || String(title).trim().length < 3) {
      res.status(400).json({ error: "Título, descripción y dirección son obligatorios" });
      return;
    }

    const parsedBudget = Number(minBudget || 0);
    if (!Number.isFinite(parsedBudget) || parsedBudget < 0) {
      res.status(400).json({ error: "El presupuesto mínimo no puede ser negativo" });
      return;
    }

    if ((preferredSpecialistId != null || sponsoredCategory != null) &&
        (typeof preferredSpecialistId !== "string" || !isQuickAccessCategory(sponsoredCategory) || preferredSpecialistId === user.id)) {
      res.status(400).json({ error: "Elige un especialista patrocinado válido." });
      return;
    }
    let validRole = targetRole === "profesional" ? "profesional" : "tecnico";
    const validUrgency = ["urgente", "express", "programado"].includes(urgency) ? urgency : "urgente";
    const validStrategy = ["intemperie", "minimo"].includes(budgetStrategy) ? budgetStrategy : "intemperie";

    const requestId = "req_" + crypto.randomUUID().slice(0, 12);
    const releaseCode = crypto.randomInt(1000, 10000).toString();

    await db.transaction(async (tx) => {
      if (preferredSpecialistId) {
        const selected = await tx.query(
          "SELECT role FROM active_sponsored_specialists WHERE user_id = $1 AND category = $2",
          [preferredSpecialistId, sponsoredCategory],
        );
        if (!selected.rows.length) throw new Error("SPONSORED_UNAVAILABLE");
        validRole = selected.rows[0].role;
      }
      await tx.query(
        `INSERT INTO service_requests (
          id, client_id, category_id, target_role, title, description, address,
          lat, lng, urgency, budget_strategy, min_budget, status, photos, release_code, location_confirmed, preferred_professional_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'open', $13, $14, $15, $16);`,
        [
          requestId,
          user.id,
          categoryId || "plomeria",
          validRole,
          String(title).trim().slice(0, 240),
          String(description).trim().slice(0, 2000),
          String(address).trim().slice(0, 400),
          lat ?? null,
          lng ?? null,
          validUrgency,
          validStrategy,
          parsedBudget,
          photos ?? [],
          releaseCode,
          lat != null && lng != null,
          preferredSpecialistId || null
        ]
      );

      await tx.query(
        `INSERT INTO client_profiles (user_id, default_address, lat, lng, total_requests)
         VALUES ($1, $2, $3, $4, 1)
         ON CONFLICT (user_id) DO UPDATE SET total_requests = client_profiles.total_requests + 1;`,
        [user.id, String(address).trim().slice(0, 300), lat ?? null, lng ?? null]
      );

      if (preferredSpecialistId) {
        await tx.query(
          `INSERT INTO notifications (id, user_id, type, title, body, data)
           VALUES ($1, $2, 'DIRECT_REQUEST', 'Solicitud directa en Diclik', $3, $4)`,
          ["notif_" + crypto.randomUUID().slice(0, 12), preferredSpecialistId,
           "Un cliente te eligió desde Acceso rápido. Abre Solicitudes para enviar una cotización.", JSON.stringify({ requestId })],
        );
      }

      await tx.query(
        "INSERT INTO audit_logs (id, actor_id, event_type, target_table, target_id, details) VALUES ($1, $2, 'SERVICE_REQUEST_CREATED', 'service_requests', $3, $4);",
        ["aud_" + crypto.randomUUID().slice(0, 12), user.id, requestId, JSON.stringify({ title, categoryId, address })]
      );
    });

    res.status(201).json({
      message: "Solicitud publicada exitosamente en el radar Diclik.com",
      requestId,
      releaseCode
    });
  } catch (error: any) {
    if (error?.message === "SPONSORED_UNAVAILABLE") {
      res.status(409).json({ error: "El perfil patrocinado ya no está disponible. Elige otro especialista o publica una solicitud abierta." });
      return;
    }
    console.error("[Create Service Request Error]:", error?.message);
    res.status(500).json({ error: "Error al publicar solicitud de servicio" });
  }
});

// GET /api/v1/services/:id (Single service request detail without leaking PII/OTP)
marketplaceRouter.get("/services/:id", async (req: Request, res: Response) => {
  try {
    const caller = await optionalUser(req);
    const { id } = req.params;
    const result = await db.query(
      `SELECT sr.id, sr.client_id, sr.category_id, sr.target_role, sr.title, sr.description,
              sr.preferred_professional_id, sr.address, sr.lat, sr.lng, sr.urgency, sr.budget_strategy, sr.min_budget,
              sr.status, sr.accepted_offer_id, sr.photos, sr.created_at, sr.updated_at,
              u.full_name as client_name, u.avatar_url as client_avatar, u.phone as client_phone,
              sc.name as category_name, sc.icon as category_icon
       FROM service_requests sr
       JOIN users u ON sr.client_id = u.id
       LEFT JOIN service_categories sc ON sr.category_id = sc.id
       WHERE sr.id = $1;`,
      [id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Solicitud de servicio no encontrada" });
      return;
    }
    const row = result.rows[0];
    if (row.preferred_professional_id && caller?.role !== "admin" &&
        caller?.id !== row.client_id && caller?.id !== row.preferred_professional_id) {
      res.status(404).json({ error: "Solicitud de servicio no encontrada" });
      return;
    }
    const canSeePhone = caller && (caller.role === "admin" || caller.id === row.client_id);
    res.json({
      ...row,
      client_phone: canSeePhone ? row.client_phone : null,
      address: canSeePhone ? row.address : null,
      lat: canSeePhone ? row.lat : null,
      lng: canSeePhone ? row.lng : null,
      photos: caller ? row.photos : [],
    });
  } catch {
    res.status(500).json({ error: "Error al consultar detalle de solicitud" });
  }
});

// PATCH /api/v1/services/:id (Owner edits open service request)
marketplaceRouter.patch("/services/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const { title, description, address, minBudget, urgency } = req.body;

    const existing = await db.query("SELECT * FROM service_requests WHERE id = $1;", [id]);
    if (existing.rows.length === 0) {
      res.status(404).json({ error: "Solicitud no encontrada" });
      return;
    }
    const sr = existing.rows[0];
    if (user.role !== "admin" && sr.client_id !== user.id) {
      res.status(403).json({ error: "No tienes permiso para modificar esta solicitud" });
      return;
    }
    if (!["open", "negotiating"].includes(sr.status)) {
      res.status(409).json({ error: "Solo se pueden editar solicitudes abiertas antes de contratar" });
      return;
    }

    await db.query(
      `UPDATE service_requests
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           location_confirmed = location_confirmed AND ($3::text IS NULL OR $3 = address),
           lat = CASE WHEN $3::text IS NOT NULL AND $3 <> address THEN NULL ELSE lat END,
           lng = CASE WHEN $3::text IS NOT NULL AND $3 <> address THEN NULL ELSE lng END,
           address = COALESCE($3, address),
           min_budget = COALESCE($4, min_budget),
           urgency = COALESCE($5, urgency),
           updated_at = NOW()
       WHERE id = $6;`,
      [
        title ? String(title).trim().slice(0, 240) : null,
        description ? String(description).trim().slice(0, 2000) : null,
        address ? String(address).trim().slice(0, 400) : null,
        minBudget !== undefined && Number(minBudget) >= 0 ? Number(minBudget) : null,
        ["urgente", "express", "programado"].includes(urgency) ? urgency : null,
        id
      ]
    );

    res.json({ message: "Solicitud actualizada correctamente", requestId: id });
  } catch {
    res.status(500).json({ error: "Error al actualizar la solicitud" });
  }
});

// DELETE /api/v1/services/:id (Owner cancels open service request before hire)
marketplaceRouter.delete("/services/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;

    const existing = await db.query("SELECT * FROM service_requests WHERE id = $1;", [id]);
    if (existing.rows.length === 0) {
      res.status(404).json({ error: "Solicitud no encontrada" });
      return;
    }
    const sr = existing.rows[0];
    if (user.role !== "admin" && sr.client_id !== user.id) {
      res.status(403).json({ error: "No tienes permiso para cancelar esta solicitud" });
      return;
    }
    if (!["open", "negotiating"].includes(sr.status)) {
      res.status(409).json({ error: "No se puede eliminar una solicitud con contratación activa o completada" });
      return;
    }

    await db.transaction(async (tx) => {
      await tx.query("UPDATE service_requests SET status = 'cancelled', updated_at = NOW() WHERE id = $1;", [id]);
      await tx.query("UPDATE offers SET status = 'rejected', updated_at = NOW() WHERE request_id = $1 AND status IN ('pending', 'countered');", [id]);
      await tx.query(
        "INSERT INTO audit_logs (id, actor_id, event_type, target_table, target_id, details) VALUES ($1, $2, 'SERVICE_REQUEST_CANCELLED', 'service_requests', $3, '{}');",
        ["aud_" + crypto.randomUUID().slice(0, 12), user.id, id]
      );
    });

    res.json({ message: "Solicitud cancelada antes de contratación", requestId: id });
  } catch {
    res.status(500).json({ error: "Error al cancelar la solicitud" });
  }
});

// GET /api/v1/services/:id/offers (Get offers for a service request with PII masking)
marketplaceRouter.get("/services/:id/offers", async (req: Request, res: Response) => {
  try {
    const caller = await optionalUser(req);
    const { id } = req.params;

    const reqInfo = await db.query("SELECT client_id, preferred_professional_id FROM service_requests WHERE id = $1;", [id]);
    const ownerId = reqInfo.rows[0]?.client_id;
    const preferred = reqInfo.rows[0]?.preferred_professional_id;
    if (preferred && caller?.role !== "admin" && caller?.id !== ownerId && caller?.id !== preferred) {
      res.status(404).json({ error: "Solicitud de servicio no encontrada" });
      return;
    }

    const result = await db.query(
      `SELECT o.*,
              u.full_name as pro_name, u.avatar_url as pro_avatar, u.phone as pro_phone,
              pp.trade as pro_trade, pp.rating as pro_rating, pp.review_count as pro_reviews,
              pp.verified as pro_verified, pp.credential_code as pro_credential
       FROM offers o
       JOIN users u ON o.professional_id = u.id
       LEFT JOIN professional_profiles pp ON u.id = pp.user_id
       WHERE o.request_id = $1
       ORDER BY o.price ASC, o.created_at DESC;`,
      [id]
    );

    const sanitized = result.rows.map((offer: any) => {
      const canSeePhone =
        caller &&
        (caller.role === "admin" ||
          caller.id === offer.professional_id ||
          (caller.id === ownerId && offer.status === "accepted"));
      return {
        ...offer,
        pro_phone: canSeePhone ? offer.pro_phone : null
      };
    });

    res.json(sanitized);
  } catch {
    res.status(500).json({ error: "Error al consultar ofertas" });
  }
});

// POST /api/v1/services/:id/offers (Pro submits offer on open request)
marketplaceRouter.post("/services/:id/offers", requireAuth, requireRole("tecnico", "profesional", "admin"), requireIdentity, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const proUser = req.user!;
    const { id } = req.params;
    const { price, etaMinutes, message } = req.body;

    const parsedPrice = Number(price);
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      res.status(400).json({ error: "El precio cotizado debe ser un monto mayor a cero" });
      return;
    }

    const reqQuery = await db.query("SELECT * FROM service_requests WHERE id = $1;", [id]);
    if (reqQuery.rows.length === 0) {
      res.status(404).json({ error: "Solicitud de servicio no encontrada" });
      return;
    }

    const serviceReq = reqQuery.rows[0];
    if (serviceReq.preferred_professional_id && serviceReq.preferred_professional_id !== proUser.id) {
      res.status(403).json({ error: "La solicitud está dirigida a otro especialista." });
      return;
    }
    if (proUser.id === serviceReq.client_id) {
      res.status(403).json({ error: "No puedes cotizar tu propia solicitud." });
      return;
    }
    if (proUser.role !== "admin") {
      const credentials = await db.query(
        "SELECT 1 FROM specialist_accreditations WHERE user_id = $1 AND status IN ('pending', 'approved')",
        [proUser.id]
      );
      if (!credentials.rows.length) {
        res.status(403).json({ code: "ACCREDITATION_REQUIRED", error: "Sube tu foto y los documentos de acreditación en Cuenta para cotizar." });
        return;
      }
    }
    if (proUser.role !== "admin" && serviceReq.target_role !== proUser.role) {
      res.status(403).json({ error: "La solicitud corresponde a otro tipo de especialista." });
      return;
    }
    if (!["open", "negotiating"].includes(serviceReq.status)) {
      res.status(409).json({ error: "Esta solicitud ya no acepta nuevas ofertas" });
      return;
    }

    const parsedEta = Math.max(5, Math.min(480, parseInt(String(etaMinutes || "15"), 10) || 15));
    const offerId = "off_" + crypto.randomUUID().slice(0, 12);

    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO offers (id, request_id, professional_id, price, eta_minutes, message, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending');`,
        [
          offerId,
          id,
          proUser.id,
          parsedPrice,
          parsedEta,
          String(message || "Propuesta formal presentada a través de Diclik.com").trim().slice(0, 1000)
        ]
      );

      await tx.query(
        `INSERT INTO notifications (id, user_id, type, title, body, data)
         VALUES ($1, $2, 'NEW_OFFER', 'Nueva oferta en Diclik.com', $3, $4);`,
        [
          "notif_" + crypto.randomUUID().slice(0, 12),
          serviceReq.client_id,
          `${proUser.fullName} ha cotizado tu servicio por RD$ ${parsedPrice.toLocaleString()}`,
          JSON.stringify({ requestId: id, offerId, price: parsedPrice })
        ]
      );
    });

    res.status(201).json({
      message: "Oferta presentada exitosamente al cliente",
      offerId
    });
  } catch (error: any) {
    console.error("[Submit Offer Error]:", error?.message);
    res.status(500).json({ error: "Error al registrar la oferta" });
  }
});

// POST /api/v1/offers/:id/counter (Client or Pro submits formal counter-offer)
marketplaceRouter.post("/offers/:id/counter", requireAuth, requireIdentity, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const { counterPrice, reason } = req.body;

    const parsedCounter = Number(counterPrice);
    if (!Number.isFinite(parsedCounter) || parsedCounter <= 0) {
      res.status(400).json({ error: "El monto de contraoferta debe ser mayor a cero" });
      return;
    }

    const offerRes = await db.query(
      `SELECT o.*, sr.client_id, sr.status as request_status
       FROM offers o JOIN service_requests sr ON o.request_id = sr.id
       WHERE o.id = $1;`,
      [id]
    );
    if (offerRes.rows.length === 0) {
      res.status(404).json({ error: "Oferta no encontrada" });
      return;
    }
    const offer = offerRes.rows[0];
    if (user.role !== "admin" && offer.client_id !== user.id && offer.professional_id !== user.id) {
      res.status(403).json({ error: "No participas en esta negociación" });
      return;
    }
    if (!["pending", "countered"].includes(offer.status) || !["open", "negotiating"].includes(offer.request_status)) {
      res.status(409).json({ error: "La oferta no admite contraofertas en su estado actual" });
      return;
    }

    const notifyUser = user.id === offer.client_id ? offer.professional_id : offer.client_id;
    await db.transaction(async (tx) => {
      const openRequest = await tx.query(
        "SELECT id FROM service_requests WHERE id = $1 AND status IN ('open', 'negotiating') FOR UPDATE;",
        [offer.request_id]
      );
      if (!openRequest.rows.length) throw new Error("OFFER_STATE_CHANGED");
      const updated = await tx.query(
        `UPDATE offers SET status = 'countered', counter_price = $1, counter_reason = $2,
                           counter_proposed_by = $3, updated_at = NOW()
         WHERE id = $4 AND status IN ('pending', 'countered') RETURNING id;`,
        [parsedCounter, String(reason || "Contraoferta formal de tarifa").trim().slice(0, 500), user.id, id]
      );
      if (!updated.rows.length) throw new Error("OFFER_STATE_CHANGED");
      await tx.query("UPDATE service_requests SET status = 'negotiating', updated_at = NOW() WHERE id = $1 AND status = 'open';", [offer.request_id]);
      await tx.query(
        `INSERT INTO notifications (id, user_id, type, title, body, data)
         VALUES ($1, $2, 'COUNTER_OFFER', 'Nueva contraoferta recibida', $3, $4);`,
        [
          "notif_" + crypto.randomUUID().slice(0, 12),
          notifyUser,
          `${user.fullName} propuso RD$ ${parsedCounter.toLocaleString()} en negociación.`,
          JSON.stringify({ offerId: id, counterPrice: parsedCounter })
        ]
      );
    });

    res.json({ message: "Contraoferta registrada", offerId: id, counterPrice: parsedCounter });
  } catch (error) {
    if (error instanceof Error && error.message === "OFFER_STATE_CHANGED") {
      res.status(409).json({ error: "La negociación cambió y ya no admite esta contraoferta." });
      return;
    }
    res.status(500).json({ error: "Error al registrar contraoferta" });
  }
});

// POST /api/v1/offers/:id/reject (Reject an open offer)
marketplaceRouter.post("/offers/:id/reject", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const offerRes = await db.query(
      `SELECT o.*, sr.client_id FROM offers o JOIN service_requests sr ON o.request_id = sr.id WHERE o.id = $1;`,
      [id]
    );
    if (offerRes.rows.length === 0) {
      res.status(404).json({ error: "Oferta no encontrada" });
      return;
    }
    const offer = offerRes.rows[0];
    if (user.role !== "admin" && offer.client_id !== user.id && offer.professional_id !== user.id) {
      res.status(403).json({ error: "No tienes autorización para rechazar esta oferta" });
      return;
    }
    if (!["pending", "countered"].includes(offer.status)) {
      res.status(409).json({ error: "La oferta ya fue resuelta anteriormente" });
      return;
    }

    const updated = await db.query(
      "UPDATE offers SET status = 'rejected', updated_at = NOW() WHERE id = $1 AND status IN ('pending', 'countered') RETURNING id;",
      [id]
    );
    if (!updated.rows.length) {
      res.status(409).json({ error: "La oferta ya fue resuelta." });
      return;
    }
    res.json({ message: "Oferta rechazada", offerId: id });
  } catch {
    res.status(500).json({ error: "Error al rechazar oferta" });
  }
});

// POST /api/v1/offers/:id/accept (Client confirms hire and locks Escrow atomically)
marketplaceRouter.post("/offers/:id/accept", requireAuth, requireIdentity, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    const { id } = req.params;

    const offerQuery = await db.query(
      `SELECT o.*, sr.client_id, sr.title as request_title, sr.release_code, sr.status as request_status
       FROM offers o
       JOIN service_requests sr ON o.request_id = sr.id
       WHERE o.id = $1;`,
      [id]
    );

    if (offerQuery.rows.length === 0) {
      res.status(404).json({ error: "Oferta no encontrada" });
      return;
    }

    const offer = offerQuery.rows[0];

    const acceptedBySpecialist = actor.id === offer.professional_id && offer.counter_proposed_by === offer.client_id;
    const acceptedByClient = actor.id === offer.client_id && offer.counter_proposed_by !== offer.client_id;
    if (actor.role !== "admin" && !acceptedBySpecialist && !acceptedByClient) {
      res.status(403).json({ error: "No tienes autorización para aceptar ofertas de esta solicitud" });
      return;
    }

    if (!["pending", "countered"].includes(offer.status)) {
      res.status(409).json({ error: "Esta oferta ya fue procesada anteriormente" });
      return;
    }

    const contractId = "ctr_" + crypto.randomUUID().slice(0, 12);
    const agreedPrice = Number(offer.status === "countered" && offer.counter_price ? offer.counter_price : offer.price);
    const platformFee = commissionInCents(Math.round(agreedPrice * 100)) / 100;
    const proPayout = Math.round((agreedPrice - platformFee) * 100) / 100;
    const otpCode = offer.release_code || crypto.randomInt(1000, 10000).toString();
    const payerId = offer.client_id;

    try {
      await db.transaction(async (tx) => {
        // 1. Atomic race-condition guard on service_request
        const reqUpdate = await tx.query(
          `UPDATE service_requests
           SET status = 'in_progress', accepted_offer_id = $1, updated_at = NOW()
           WHERE id = $2 AND status IN ('open', 'negotiating')
           RETURNING id;`,
          [id, offer.request_id]
        );
        if (reqUpdate.rows.length === 0) {
          throw new Error("CONFLICT_ALREADY_HIRED");
        }

        const accepted = await tx.query(
          `UPDATE offers SET status = 'accepted', updated_at = NOW()
           WHERE id = $1 AND status = $2 AND counter_price IS NOT DISTINCT FROM $3
             AND counter_proposed_by IS NOT DISTINCT FROM $4 RETURNING id;`,
          [id, offer.status, offer.counter_price, offer.counter_proposed_by]
        );
        if (!accepted.rows.length) throw new Error("OFFER_STATE_CHANGED");

        const wallet = await tx.query(
          `UPDATE wallet_ledgers
           SET balance_available = balance_available - $1,
               balance_locked_escrow = balance_locked_escrow + $1,
               updated_at = NOW()
           WHERE user_id = $2 AND balance_available >= $1 RETURNING user_id;`,
          [agreedPrice, payerId]
        );
        if (!wallet.rows.length) throw new Error("INSUFFICIENT_FUNDS");

        await tx.query("UPDATE offers SET status = 'rejected', updated_at = NOW() WHERE request_id = $1 AND id != $2;", [offer.request_id, id]);

        // 4. Create contract
        await tx.query(
          `INSERT INTO contracts (
            id, request_id, client_id, professional_id, offer_id, agreed_price,
            commission_rate, platform_fee, professional_payout, status, otp_code
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'held_in_escrow', $10);`,
          [contractId, offer.request_id, payerId, offer.professional_id, id, agreedPrice, commissionBasisPoints / 10_000, platformFee, proPayout, otpCode]
        );

        await tx.query(
          `INSERT INTO contract_destinations (contract_id, lat, lng)
           SELECT $1, lat, lng FROM service_requests
           WHERE id = $2 AND location_confirmed;`,
          [contractId, offer.request_id]
        );

        // 5. Lock funds in Escrow Hold table
        await tx.query(
          `INSERT INTO escrow_holds (id, contract_id, amount, status, reason)
           VALUES ($1, $2, $3, 'locked', 'Pago retenido en custodia preventiva Escrow Diclik.com hasta validación OTP');`,
          ["esc_" + crypto.randomUUID().slice(0, 12), contractId, agreedPrice]
        );

        // 7. Record financial ledger transaction
        await tx.query(
          `INSERT INTO financial_transactions (
            id, user_id, contract_id, type, amount, status, idempotency_key, description
          ) VALUES ($1, $2, $3, 'escrow_hold', $4, 'completed', $5, $6);`,
          [
            "tx_" + crypto.randomUUID().slice(0, 12),
            payerId,
            contractId,
            agreedPrice,
            "idem_escrow_" + contractId,
            `Custodia preventiva Escrow Diclik.com para contratación: ${offer.request_title}`
          ]
        );

        // 8. Create conversation and notify pro
        const convId = "conv_" + crypto.randomUUID().slice(0, 12);
        await tx.query(
          `INSERT INTO conversations (id, request_id, client_id, professional_id)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING;`,
          [convId, offer.request_id, payerId, offer.professional_id]
        );

        await tx.query(
          `INSERT INTO messages (id, conversation_id, sender_id, message_type, content)
           VALUES ($1, $2, $3, 'deal_accepted', $4);`,
          [
            "msg_" + crypto.randomUUID().slice(0, 12),
            convId,
            actor.id,
            `¡Acuerdo formal cerrado en Diclik.com por RD$ ${agreedPrice.toLocaleString()}! Custodia Escrow activada.`
          ]
        );

        await tx.query(
          `INSERT INTO notifications (id, user_id, type, title, body, data)
           VALUES ($1, $2, 'CONTRACT_CREATED', '¡Oferta aceptada!', $3, $4);`,
          [
            "notif_" + crypto.randomUUID().slice(0, 12),
            acceptedBySpecialist ? payerId : offer.professional_id,
            `Se confirmó el acuerdo por RD$ ${agreedPrice.toLocaleString()}. Fondos protegidos en Escrow.`,
            JSON.stringify({ contractId, requestId: offer.request_id })
          ]
        );

        await tx.query(
          `INSERT INTO audit_logs (id, actor_id, event_type, target_table, target_id, details)
           VALUES ($1, $2, 'CONTRACT_ESCROW_LOCKED', 'contracts', $3, $4);`,
          ["aud_" + crypto.randomUUID().slice(0, 12), actor.id, contractId, JSON.stringify({ offerId: id, agreedPrice })]
        );
      });
    } catch (txErr: any) {
      if (txErr.message === "CONFLICT_ALREADY_HIRED") {
        res.status(409).json({ error: "Esta solicitud ya tiene una oferta aceptada o fue cerrada." });
        return;
      }
      if (txErr.message === "OFFER_STATE_CHANGED") {
        res.status(409).json({ error: "La oferta cambió. Actualiza la negociación antes de aceptar." });
        return;
      }
      if (txErr.message === "INSUFFICIENT_FUNDS") {
        res.status(402).json({ error: "Saldo disponible insuficiente en tu billetera para bloquear la garantía Escrow." });
        return;
      }
      throw txErr;
    }

    res.json({
      message: "Contratación formalizada exitosamente con garantía Escrow Diclik.com",
      contractId,
      agreedPrice,
      otpCode: actor.id === payerId || actor.role === "admin" ? otpCode : undefined
    });
  } catch (error: any) {
    console.error("[Accept Offer Error]:", error?.message);
    res.status(500).json({ error: "Error al procesar la contratación" });
  }
});

// GET /api/v1/contracts (Authenticated user's contracts & history)
marketplaceRouter.get("/contracts", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const query =
      user.role === "admin"
        ? `SELECT c.*, sr.title as request_title, sr.address, sr.category_id,
                  cu.full_name as client_name, pu.full_name as pro_name
           FROM contracts c
           JOIN service_requests sr ON c.request_id = sr.id
           JOIN users cu ON c.client_id = cu.id
           JOIN users pu ON c.professional_id = pu.id
           ORDER BY c.created_at DESC LIMIT 100;`
        : `SELECT c.*, sr.title as request_title, sr.address, sr.category_id,
                  cu.full_name as client_name, pu.full_name as pro_name
           FROM contracts c
           JOIN service_requests sr ON c.request_id = sr.id
           JOIN users cu ON c.client_id = cu.id
           JOIN users pu ON c.professional_id = pu.id
           WHERE c.client_id = $1 OR c.professional_id = $1
           ORDER BY c.created_at DESC LIMIT 100;`;

    const result = await db.query(query, user.role === "admin" ? [] : [user.id]);
    const sanitized = result.rows.map((c: any) => ({
      ...c,
      // Only expose OTP release code to the client owner or admin, never to the professional
      otp_code: user.role === "admin" || user.id === c.client_id ? c.otp_code : undefined
    }));
    res.json(sanitized);
  } catch {
    res.status(500).json({ error: "Error al consultar historial de contratos" });
  }
});

// PATCH /api/v1/contracts/:id/status (Update execution stage cleanly)
marketplaceRouter.patch("/contracts/:id/status", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const { status } = req.body;

    if (!["active_in_transit", "in_progress"].includes(status)) {
      res.status(400).json({ error: "Estado de transición inválido. Use 'active_in_transit' o 'in_progress'." });
      return;
    }

    const contractRes = await db.query("SELECT * FROM contracts WHERE id = $1;", [id]);
    if (contractRes.rows.length === 0) {
      res.status(404).json({ error: "Contrato no encontrado" });
      return;
    }

    const contract = contractRes.rows[0];
    if (user.role !== "admin" && contract.professional_id !== user.id) {
      res.status(403).json({ error: "Solo el especialista asignado puede actualizar el estado operativo." });
      return;
    }
    const previousStatus = status === "active_in_transit" ? "held_in_escrow" : "active_in_transit";
    const transitioned = await db.transaction(async tx => {
      const updated = await tx.query(
        "UPDATE contracts SET status = $1 WHERE id = $2 AND status = $3 RETURNING id;",
        [status, id, previousStatus]
      );
      if (!updated.rows.length) {
        const current = await tx.query("SELECT 1 FROM contracts WHERE id = $1 AND status = $2;", [id, status]);
        return current.rows.length > 0;
      }
      if (status === "in_progress") {
        await tx.query(
          `INSERT INTO notifications (id, user_id, type, title, body, data)
           VALUES ($1, $2, 'SPECIALIST_ARRIVED', 'Llegada registrada', $3, $4);`,
          ["notif_" + crypto.randomUUID().slice(0, 12), contract.client_id,
           "Tu especialista marcó su llegada al lugar del servicio.", JSON.stringify({ contractId: id })]
        );
      }
      return true;
    });
    if (!transitioned) {
      res.status(409).json({ error: "El estado actual no permite esta transición." });
      return;
    }
    res.json({ message: "Estado operativo actualizado", contractId: id, status });
  } catch {
    res.status(500).json({ error: "Error al actualizar estado del contrato" });
  }
});

// Contract GPS is shared explicitly by the assigned specialist while the contract is active.
marketplaceRouter.put("/contracts/:id/location", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { lat, lng } = req.body;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    res.status(400).json({ error: "Coordenadas inválidas." });
    return;
  }
  try {
    const result = await db.query(
      `INSERT INTO contract_locations (contract_id, lat, lng)
       SELECT id, $2, $3 FROM contracts
       WHERE id = $1 AND professional_id = $4 AND status IN ('held_in_escrow', 'active_in_transit', 'in_progress')
       ON CONFLICT (contract_id) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, updated_at = NOW()
       RETURNING lat, lng, updated_at;`,
      [req.params.id, lat, lng, req.user!.id],
    );
    if (!result.rows.length) {
      res.status(403).json({ error: "Solo el especialista asignado puede compartir su ubicación en un contrato activo." });
      return;
    }
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: "No se pudo compartir la ubicación." });
  }
});

marketplaceRouter.put("/contracts/:id/destination", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { lat, lng } = req.body;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    res.status(400).json({ error: "Coordenadas inválidas." });
    return;
  }
  try {
    const result = await db.query(
      `INSERT INTO contract_destinations (contract_id, lat, lng)
       SELECT id, $2, $3 FROM contracts
       WHERE id = $1 AND client_id = $4 AND status IN ('held_in_escrow', 'active_in_transit', 'in_progress')
       ON CONFLICT (contract_id) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng
       RETURNING contract_id;`,
      [req.params.id, lat, lng, req.user!.id],
    );
    if (!result.rows.length) {
      res.status(403).json({ error: "Solo el cliente del contrato activo puede fijar el punto del servicio." });
      return;
    }
    res.json({ lat, lng });
  } catch {
    res.status(500).json({ error: "No se pudo guardar el punto del servicio." });
  }
});

marketplaceRouter.get("/contracts/:id/location", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await db.query(
      `SELECT l.lat, l.lng, l.updated_at, d.lat AS destination_lat, d.lng AS destination_lng FROM contracts c
       LEFT JOIN contract_locations l ON l.contract_id = c.id
       LEFT JOIN contract_destinations d ON d.contract_id = c.id
       WHERE c.id = $1 AND (c.client_id = $2 OR c.professional_id = $2)
       AND c.status IN ('held_in_escrow', 'active_in_transit', 'in_progress');`,
      [req.params.id, req.user!.id],
    );
    if (!result.rows.length) {
      res.status(403).json({ error: "Ubicación disponible solo para participantes de un contrato activo." });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    const { lat, lng, updated_at, destination_lat, destination_lng } = result.rows[0];
    const specialist = updated_at ? { lat, lng, updated_at } : null;
    if (req.query.view === "map") {
      res.json({
        specialist,
        destination: destination_lat == null || destination_lng == null ? null : { lat: destination_lat, lng: destination_lng },
      });
      return;
    }
    res.json(specialist);
  } catch {
    res.status(500).json({ error: "No se pudo consultar la ubicación." });
  }
});

// POST /api/v1/contracts/:id/verify-otp (Complete service and release Escrow)
marketplaceRouter.post("/contracts/:id/verify-otp", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const { otpInput } = req.body;

    if (!checkOtpRateLimit(id)) {
      res.status(429).json({ error: "Demasiados intentos incorrectos de OTP para este contrato. Espera 10 minutos." });
      return;
    }

    const contractQuery = await db.query("SELECT * FROM contracts WHERE id = $1;", [id]);
    if (contractQuery.rows.length === 0) {
      res.status(404).json({ error: "Contrato no encontrado" });
      return;
    }

    const contract = contractQuery.rows[0];

    // Strict participant ownership verification
    if (user.role !== "admin" && contract.client_id !== user.id && contract.professional_id !== user.id) {
      res.status(403).json({ error: "Acceso denegado: No eres parte autorizada de este contrato" });
      return;
    }

    if (contract.status === "completed") {
      res.status(409).json({ error: "Este contrato ya fue concluido y sus fondos liberados previamente" });
      return;
    }

    if (!["held_in_escrow", "active_in_transit", "in_progress"].includes(contract.status)) {
      res.status(409).json({ error: `No es posible liberar fondos en estado '${contract.status}'` });
      return;
    }

    const submittedOtp = String(otpInput || "").trim();
    if (!submittedOtp || contract.otp_code !== submittedOtp) {
      recordFailedOtpAttempt(id);
      res.status(400).json({ error: "Código de entrega OTP incorrecto. Solicita al cliente el código de 4 dígitos." });
      return;
    }

    otpAttempts.delete(id);

    await db.transaction(async (tx) => {
      // Atomic guard against concurrent OTP verification race
      const upd = await tx.query(
        `UPDATE contracts SET status = 'completed', otp_verified = TRUE, completed_at = NOW()
         WHERE id = $1 AND status IN ('held_in_escrow', 'active_in_transit', 'in_progress')
         RETURNING id;`,
        [id]
      );
      if (upd.rows.length === 0) {
        throw new Error("ALREADY_COMPLETED");
      }

      await tx.query(
        "UPDATE service_requests SET status = 'completed', updated_at = NOW() WHERE id = $1;",
        [contract.request_id]
      );

      await tx.query(
        "UPDATE escrow_holds SET status = 'released_to_pro', released_at = NOW() WHERE contract_id = $1;",
        [id]
      );

      await tx.query(
        `UPDATE wallet_ledgers
         SET balance_locked_escrow = GREATEST(0, balance_locked_escrow - $1),
             total_spent = total_spent + $1,
             updated_at = NOW()
         WHERE user_id = $2;`,
        [contract.agreed_price, contract.client_id]
      );

      await tx.query(
        `UPDATE wallet_ledgers
         SET balance_available = balance_available + $1,
             total_earned = total_earned + $1,
             updated_at = NOW()
         WHERE user_id = $2;`,
        [contract.professional_payout, contract.professional_id]
      );

      await tx.query(
        `INSERT INTO financial_transactions (id, user_id, contract_id, type, amount, status, idempotency_key, description)
         VALUES ($1, $2, $3, 'escrow_release', $4, 'completed', $5, 'Liberación de fondos completada con OTP verificado en Diclik.com');`,
        ["tx_" + crypto.randomUUID().slice(0, 12), contract.professional_id, id, contract.professional_payout, "idem_rel_" + id]
      );

      await tx.query(
        `INSERT INTO financial_transactions (id, user_id, contract_id, type, amount, status, idempotency_key, description)
         VALUES ($1, NULL, $2, 'fee_deduction', $3, 'completed', $4, $5);`,
        ["tx_" + crypto.randomUUID().slice(0, 12), id, contract.platform_fee, "idem_fee_" + id, `Comisión transaccional de plataforma Diclik.com (${Math.round(Number(contract.commission_rate) * 10000) / 100}%)`]
      );

      await tx.query(
        `INSERT INTO audit_logs (id, actor_id, event_type, target_table, target_id, details)
         VALUES ($1, $2, 'ESCROW_OTP_RELEASED', 'contracts', $3, $4);`,
        ["aud_" + crypto.randomUUID().slice(0, 12), user.id, id, JSON.stringify({ payout: contract.professional_payout, fee: contract.platform_fee })]
      );

      await tx.query(
        `INSERT INTO notifications (id, user_id, type, title, body, data)
         VALUES ($1, $2, 'ESCROW_RELEASED', 'Pago liberado en Diclik.com', $3, $4);`,
        [
          "notif_" + crypto.randomUUID().slice(0, 12),
          contract.professional_id,
          `Se liberaron RD$ ${Number(contract.professional_payout).toLocaleString()} a tu saldo disponible.`,
          JSON.stringify({ contractId: id })
        ]
      );
    });

    res.json({
      message: "Servicio verificado y fondos liberados exitosamente",
      contractId: id,
      payoutAmount: contract.professional_payout,
      platformFee: contract.platform_fee
    });
  } catch (error: any) {
    if (error.message === "ALREADY_COMPLETED") {
      res.status(409).json({ error: "El contrato ya fue liberado concurrentemente." });
      return;
    }
    console.error("[Verify OTP Error]:", error?.message);
    res.status(500).json({ error: "Error al verificar código OTP" });
  }
});

// POST /api/v1/contracts/:id/cancel (Auditable cancellation with Diclik penalty rules)
marketplaceRouter.post("/contracts/:id/cancel", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const { scenario: requestedScenario, reason } = req.body;

    const validScenarios = ["client_before_arrival", "client_after_arrival", "tech_circumvention"];
    if (!validScenarios.includes(requestedScenario)) {
      res.status(400).json({ error: "Escenario de cancelación inválido" });
      return;
    }

    const contractRes = await db.query("SELECT * FROM contracts WHERE id = $1;", [id]);
    if (contractRes.rows.length === 0) {
      res.status(404).json({ error: "Contrato no encontrado" });
      return;
    }

    const contract = contractRes.rows[0];
    if (user.role !== "admin" && contract.client_id !== user.id) {
      res.status(403).json({ error: "Solo el cliente o un administrador puede aplicar esta cancelación. El especialista puede abrir una disputa." });
      return;
    }

    if (!["held_in_escrow", "active_in_transit", "in_progress"].includes(contract.status)) {
      res.status(409).json({ error: "Solo se pueden cancelar contratos en custodia activa" });
      return;
    }

    const scenario = user.role === "admin" && requestedScenario === "tech_circumvention"
      ? "tech_circumvention"
      : contract.status === "in_progress" ? "client_after_arrival" : "client_before_arrival";
    const agreed = Number(contract.agreed_price);
    let penaltyRate = 15;
    let penaltyAmount = 0;
    let platformEarnings = 0;
    let specialistComp = 0;
    let clientRefund = 0;

    if (scenario === "client_before_arrival") {
      penaltyRate = 15;
      penaltyAmount = Math.round(agreed * 0.15 * 100) / 100;
      platformEarnings = Math.round(penaltyAmount * 0.15 * 100) / 100;
      specialistComp = Math.round((penaltyAmount - platformEarnings) * 100) / 100;
      clientRefund = Math.round((agreed - penaltyAmount) * 100) / 100;
    } else if (scenario === "client_after_arrival") {
      penaltyRate = 20;
      penaltyAmount = Math.round(agreed * 0.20 * 100) / 100;
      platformEarnings = Math.round(penaltyAmount * 0.20 * 100) / 100;
      specialistComp = Math.round((penaltyAmount - platformEarnings) * 100) / 100;
      clientRefund = Math.round((agreed - penaltyAmount) * 100) / 100;
    } else {
      // tech_circumvention: 100% penalty/sanction, full client refund
      penaltyRate = 100;
      penaltyAmount = agreed;
      platformEarnings = 0;
      specialistComp = 0;
      clientRefund = agreed;
    }

    const cancelReason = String(reason || `Cancelación bajo regla ${scenario}`).trim();
    const cancelId = "canc_" + crypto.randomUUID().slice(0, 12);

    await db.transaction(async (tx) => {
      const upd = await tx.query(
        `UPDATE contracts SET status = 'cancelled' WHERE id = $1 AND status = $2 RETURNING id;`,
        [id, contract.status]
      );
      if (upd.rows.length === 0) throw new Error("CONFLICT_CANCEL");

      await tx.query("UPDATE service_requests SET status = 'cancelled', updated_at = NOW() WHERE id = $1;", [contract.request_id]);
      await tx.query(
        "UPDATE escrow_holds SET status = 'refunded_to_client', refunded_at = NOW(), reason = $1 WHERE contract_id = $2;",
        [cancelReason, id]
      );

      await tx.query(
        `INSERT INTO contract_cancellations (
          id, contract_id, cancelled_by_user_id, cancelled_by_role, scenario,
          penalty_rate_percent, penalty_amount, platform_earnings, specialist_compensation, client_refund_amount, reason
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);`,
        [cancelId, id, user.id, user.role, scenario, penaltyRate, penaltyAmount, platformEarnings, specialistComp, clientRefund, cancelReason]
      );

      // Update client ledger: release full escrow lock and credit refund back to available balance
      await tx.query(
        `UPDATE wallet_ledgers
         SET balance_locked_escrow = GREATEST(0, balance_locked_escrow - $1),
             balance_available = balance_available + $2,
             updated_at = NOW()
         WHERE user_id = $3;`,
        [agreed, clientRefund, contract.client_id]
      );

      if (specialistComp > 0) {
        await tx.query(
          `UPDATE wallet_ledgers
           SET balance_available = balance_available + $1,
               total_earned = total_earned + $1,
               updated_at = NOW()
           WHERE user_id = $2;`,
          [specialistComp, contract.professional_id]
        );
      }

      if (clientRefund > 0) {
        await tx.query(
          `INSERT INTO financial_transactions (id, user_id, contract_id, type, amount, status, idempotency_key, description)
           VALUES ($1, $2, $3, 'refund', $4, 'completed', $5, $6);`,
          ["tx_" + crypto.randomUUID().slice(0, 12), contract.client_id, id, clientRefund, "idem_canc_ref_" + id, `Reembolso por cancelación (${scenario})`]
        );
      }

      if (specialistComp > 0) {
        await tx.query(
          `INSERT INTO financial_transactions (id, user_id, contract_id, type, amount, status, idempotency_key, description)
           VALUES ($1, $2, $3, 'penalty', $4, 'completed', $5, $6);`,
          ["tx_" + crypto.randomUUID().slice(0, 12), contract.professional_id, id, specialistComp, "idem_canc_comp_" + id, `Compensación por cancelación de cliente (${scenario})`]
        );
      }

      await tx.query(
        `INSERT INTO audit_logs (id, actor_id, event_type, target_table, target_id, details)
         VALUES ($1, $2, 'CONTRACT_CANCELLED', 'contracts', $3, $4);`,
        ["aud_" + crypto.randomUUID().slice(0, 12), user.id, id, JSON.stringify({ scenario, penaltyAmount, clientRefund, specialistComp, platformEarnings })]
      );
    });

    res.json({
      message: "Contrato cancelado y liquidación aplicada",
      cancellationId: cancelId,
      scenario,
      penaltyRatePercent: penaltyRate,
      penaltyAmount,
      platformEarnings,
      specialistCompensation: specialistComp,
      clientRefundAmount: clientRefund
    });
  } catch (error: any) {
    if (error.message === "CONFLICT_CANCEL") {
      res.status(409).json({ error: "El contrato ya fue cancelado o completado." });
      return;
    }
    console.error("[Cancel Contract Error]:", error?.message);
    res.status(500).json({ error: "Error al cancelar el contrato" });
  }
});

// POST /api/v1/contracts/:id/dispute (Participant opens claim/dispute)
marketplaceRouter.post("/contracts/:id/dispute", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const { reason, evidenceUrls } = req.body;

    if (!reason || String(reason).trim().length < 5) {
      res.status(400).json({ error: "Describe el motivo de la reclamación (mínimo 5 caracteres)" });
      return;
    }

    const contractRes = await db.query("SELECT * FROM contracts WHERE id = $1;", [id]);
    if (contractRes.rows.length === 0) {
      res.status(404).json({ error: "Contrato no encontrado" });
      return;
    }

    const contract = contractRes.rows[0];
    if (user.role !== "admin" && contract.client_id !== user.id && contract.professional_id !== user.id) {
      res.status(403).json({ error: "No tienes autorización para abrir disputa en este contrato" });
      return;
    }

    if (["completed", "cancelled", "disputed"].includes(contract.status)) {
      res.status(409).json({ error: `No es posible abrir disputa en estado '${contract.status}'` });
      return;
    }

    const disputeId = "disp_" + crypto.randomUUID().slice(0, 12);

    await db.transaction(async (tx) => {
      const updated = await tx.query(
        "UPDATE contracts SET status = 'disputed' WHERE id = $1 AND status IN ('held_in_escrow', 'active_in_transit', 'in_progress') RETURNING id;",
        [id]
      );
      if (!updated.rows.length) throw new Error("DISPUTE_STATE_CHANGED");
      await tx.query("UPDATE escrow_holds SET status = 'disputed', reason = $1 WHERE contract_id = $2;", [String(reason).trim(), id]);

      await tx.query(
        `INSERT INTO disputes (id, contract_id, opened_by, reason, evidence_urls, status)
         VALUES ($1, $2, $3, $4, $5, 'open');`,
        [disputeId, id, user.id, String(reason).trim(), Array.isArray(evidenceUrls) ? evidenceUrls : []]
      );

      await tx.query(
        `INSERT INTO audit_logs (id, actor_id, event_type, target_table, target_id, details)
         VALUES ($1, $2, 'DISPUTE_OPENED', 'disputes', $3, $4);`,
        ["aud_" + crypto.randomUUID().slice(0, 12), user.id, disputeId, JSON.stringify({ contractId: id, reason })]
      );
    });

    res.status(201).json({
      message: "Reclamación registrada y fondos congelados para arbitraje Diclik.com",
      disputeId,
      contractId: id
    });
  } catch (error: any) {
    if (error?.message === "DISPUTE_STATE_CHANGED") {
      res.status(409).json({ error: "El estado del contrato cambió antes de abrir la disputa." });
      return;
    }
    console.error("[Dispute Open Error]:", error?.message);
    res.status(500).json({ error: "Error al registrar la reclamación" });
  }
});

// POST /api/v1/contracts/:id/review (Rate completed service & update professional score)
marketplaceRouter.post("/contracts/:id/review", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const { rating, comment } = req.body;

    const numRating = parseInt(String(rating), 10);
    if (!Number.isInteger(numRating) || numRating < 1 || numRating > 5) {
      res.status(400).json({ error: "La calificación debe ser un número entero entre 1 y 5" });
      return;
    }

    const contractRes = await db.query("SELECT * FROM contracts WHERE id = $1;", [id]);
    if (contractRes.rows.length === 0) {
      res.status(404).json({ error: "Contrato no encontrado" });
      return;
    }
    const contract = contractRes.rows[0];

    if (contract.client_id !== user.id && contract.professional_id !== user.id) {
      res.status(403).json({ error: "Solo participantes del contrato pueden calificar el servicio" });
      return;
    }

    if (contract.status !== "completed") {
      res.status(409).json({ error: "Solo se pueden calificar servicios completados" });
      return;
    }

    const dupCheck = await db.query(
      "SELECT id FROM reviews WHERE contract_id = $1 AND reviewer_id = $2;",
      [id, user.id]
    );
    if (dupCheck.rows.length > 0) {
      res.status(409).json({ error: "Ya emitiste una calificación para este contrato" });
      return;
    }

    const targetId = user.id === contract.client_id ? contract.professional_id : contract.client_id;
    const reviewId = "rev_" + crypto.randomUUID().slice(0, 12);

    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO reviews (id, contract_id, reviewer_id, target_id, rating, comment)
         VALUES ($1, $2, $3, $4, $5, $6);`,
        [reviewId, id, user.id, targetId, numRating, String(comment || "").trim().slice(0, 1000)]
      );

      // Recalculate professional rating if target is the professional
      if (targetId === contract.professional_id) {
        const stats = await tx.query(
          "SELECT COUNT(*) as cnt, AVG(rating) as avg_rating FROM reviews WHERE target_id = $1;",
          [targetId]
        );
        const newAvg = Math.round(Number(stats.rows[0].avg_rating || numRating) * 100) / 100;
        const newCnt = parseInt(stats.rows[0].cnt || "1", 10);
        await tx.query(
          "UPDATE professional_profiles SET rating = $1, review_count = $2 WHERE user_id = $3;",
          [newAvg, newCnt, targetId]
        );
      }
    });

    res.status(201).json({
      message: "Calificación registrada en Diclik.com",
      reviewId,
      rating: numRating
    });
  } catch {
    res.status(500).json({ error: "Error al guardar calificación" });
  }
});

// GET /api/v1/professionals/:id/reviews
marketplaceRouter.get("/professionals/:id/reviews", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `SELECT r.id, r.rating, r.comment, r.created_at, u.full_name as reviewer_name
       FROM reviews r
       JOIN users u ON r.reviewer_id = u.id
       WHERE r.target_id = $1
       ORDER BY r.created_at DESC
       LIMIT 50;`,
      [id]
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: "Error al consultar reseñas" });
  }
});

// GET /api/v1/notifications
marketplaceRouter.get("/notifications", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await db.query(
      "SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50;",
      [req.user!.id]
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: "Error al cargar notificaciones" });
  }
});

// PATCH /api/v1/notifications/:id/read
marketplaceRouter.patch("/notifications/:id/read", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    await db.query(
      "UPDATE notifications SET read = TRUE WHERE id = $1 AND user_id = $2;",
      [id, req.user!.id]
    );
    res.json({ message: "Notificación marcada como leída" });
  } catch {
    res.status(500).json({ error: "Error al actualizar notificación" });
  }
});
