import { eligibleQuickAccessCategories, isQuickAccessCategory } from "../../quickAccess.ts";
import { Router, Response, RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.ts";
import { AuthenticatedRequest, requireAuth, requireRole } from "../middleware/auth.ts";

export const accreditationRouter = Router();
const specialistOnly = [requireAuth, requireRole("tecnico", "profesional")];
const reviewerOnly = [requireAuth, requireRole("admin")];
const metadata = "revision, kind, status, reason, submitted_at, reviewed_at";

function safe(handler: (req: AuthenticatedRequest, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => { void handler(req, res).catch(next); };
}

function validFile(file: { mime?: string; data?: string } | undefined, limit: number, photo = false) {
  if (typeof file?.data !== "string" || file.data.length > Math.ceil(limit / 3) * 4) return false;
  const bytes = Buffer.from(file.data, "base64");
  if (bytes.length > limit || bytes.toString("base64") !== file.data) return false;
  if (file.mime === "image/jpeg") return bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  if (file.mime === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return !photo && file.mime === "application/pdf" && bytes.subarray(0, 5).toString() === "%PDF-";
}

accreditationRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});

accreditationRouter.get("/sponsorship", ...specialistOnly, safe(async (req, res) => {
  const userId = req.user!.id;
  const [profile, requests, listings] = await Promise.all([
    db.query("SELECT verified, trade FROM professional_profiles WHERE user_id = $1", [userId]),
    db.query("SELECT category FROM sponsor_requests WHERE user_id = $1 ORDER BY submitted_at", [userId]),
    db.query("SELECT category, expires_at FROM active_sponsored_specialists WHERE user_id = $1 ORDER BY expires_at", [userId]),
  ]);
  const specialist = profile.rows[0];
  res.json({
    verified: Boolean(specialist?.verified),
    eligibleCategories: eligibleQuickAccessCategories(req.user!.role, specialist?.trade ?? ""),
    requested: requests.rows.map(item => item.category),
    active: listings.rows,
  });
}));

accreditationRouter.post("/sponsorship", ...specialistOnly, safe(async (req, res) => {
  const { category } = req.body ?? {};
  if (!isQuickAccessCategory(category)) {
    res.status(400).json({ error: "Selecciona una categoría válida." });
    return;
  }
  const user = req.user!;
  const outcome = await db.transaction(async tx => {
    const profile = await tx.query("SELECT verified, trade FROM professional_profiles WHERE user_id = $1 FOR UPDATE", [user.id]);
    const specialist = profile.rows[0];
    if (!specialist?.verified || !eligibleQuickAccessCategories(user.role, specialist.trade).includes(category)) return "ineligible";
    const active = await tx.query("SELECT 1 FROM active_sponsored_specialists WHERE user_id = $1 AND category = $2", [user.id, category]);
    if (active.rows.length) return "active";
    await tx.query("INSERT INTO sponsor_requests (user_id, category) VALUES ($1, $2) ON CONFLICT DO NOTHING", [user.id, category]);
    return "requested";
  });
  if (outcome === "ineligible") {
    res.status(403).json({ error: "Tu perfil debe estar acreditado en la categoría elegida." });
    return;
  }
  if (outcome === "active") {
    res.status(409).json({ error: "Ya tienes una publicación activa en esa categoría." });
    return;
  }
  res.json({ requested: true });
}));

accreditationRouter.get("/client-photo", requireAuth, requireRole("cliente"), safe(async (req, res) => {
  const result = await db.query("SELECT avatar_url FROM users WHERE id = $1", [req.user!.id]);
  res.json({ avatar: result.rows[0]?.avatar_url ?? null });
}));

accreditationRouter.put("/client-photo", requireAuth, requireRole("cliente"), safe(async (req, res) => {
  const { photo } = req.body ?? {};
  if (!validFile(photo, 120 * 1024, true)) {
    res.status(400).json({ error: "Adjunta una foto de perfil válida en JPG o PNG." });
    return;
  }
  const avatar = `data:${photo.mime};base64,${photo.data}`;
  await db.query("UPDATE users SET avatar_url = $2, updated_at = NOW() WHERE id = $1", [req.user!.id, avatar]);
  res.json({ avatar });
}));

accreditationRouter.delete("/client-photo", requireAuth, requireRole("cliente"), safe(async (req, res) => {
  await db.query("UPDATE users SET avatar_url = NULL, updated_at = NOW() WHERE id = $1", [req.user!.id]);
  res.json({ avatar: null });
}));

accreditationRouter.get("/identity", requireAuth, safe(async (req, res) => {
  const result = await db.query("SELECT submitted_at FROM identity_documents WHERE user_id = $1", [req.user!.id]);
  res.json({ submitted: result.rows.length > 0 });
}));

accreditationRouter.put("/identity", requireAuth, safe(async (req, res) => {
  const { document } = req.body ?? {};
  if (!validFile(document, 1024 * 1024, true)) {
    res.status(400).json({ error: "Adjunta una foto legible de tu cédula o identificación en JPG o PNG de hasta 1 MB." });
    return;
  }
  await db.query(
    `INSERT INTO identity_documents (user_id, mime, document_data) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET mime = EXCLUDED.mime, document_data = EXCLUDED.document_data, submitted_at = NOW()`,
    [req.user!.id, document.mime, document.data]
  );
  res.status(201).json({ submitted: true });
}));

accreditationRouter.get("/identity/review", ...reviewerOnly, safe(async (_req, res) => {
  const result = await db.query(
    `SELECT d.user_id, u.full_name, u.role, d.submitted_at
       FROM identity_documents d JOIN users u ON u.id = d.user_id
       ORDER BY d.submitted_at DESC LIMIT 100`
  );
  res.json(result.rows);
}));

accreditationRouter.get("/identity/review/:userId", ...reviewerOnly, safe(async (req, res) => {
  const result = await db.query("SELECT mime, document_data FROM identity_documents WHERE user_id = $1", [req.params.userId]);
  const file = result.rows[0];
  if (!file) {
    res.sendStatus(404);
    return;
  }
  res.setHeader("Content-Disposition", `attachment; filename="identificacion.${file.mime === "image/png" ? "png" : "jpg"}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.type(file.mime).send(Buffer.from(file.document_data, "base64"));
}));

accreditationRouter.get("/mine", ...specialistOnly, safe(async (req, res) => {
  const result = await db.query(`SELECT ${metadata} FROM specialist_accreditations WHERE user_id = $1`, [req.user!.id]);
  res.json(result.rows[0] ?? null);
}));

accreditationRouter.put("/mine", ...specialistOnly, safe(async (req, res) => {
  const { kind, photo, document, references, referencesConsent } = req.body;
  const isReferences = kind === "referencias";
  const role = req.user!.role;
  if (!["titulo", "diploma", "carta", "referencias"].includes(kind) ||
      (isReferences && role !== "tecnico") || (kind === "carta" && role === "tecnico")) {
    res.status(400).json({ error: "Selecciona una modalidad de acreditación válida para tu perfil." });
    return;
  }
  const evidence = isReferences ? references : [document];
  if (!validFile(photo, 180 * 1024, true) || !Array.isArray(evidence) ||
      evidence.length !== (isReferences ? 3 : 1) ||
      !evidence.every(file => validFile(file, isReferences ? 400 * 1024 : 1024 * 1024)) ||
      (isReferences && (referencesConsent !== true || new Set(evidence.map(file => file.data)).size !== 3))) {
    res.status(400).json({
      error: isReferences
        ? "Adjunta tu foto y tres cartas diferentes de clientes, con su permiso. Cada carta debe ser PDF, JPG o PNG de hasta 400 KB."
        : "Adjunta una foto JPG o PNG de hasta 180 KB y un documento PDF, JPG o PNG de hasta 1 MB.",
    });
    return;
  }
  const [firstFile, ...extraReferences] = evidence;
  const result = await db.transaction(async tx => {
    const userId = req.user!.id;
    await tx.query("SELECT user_id FROM professional_profiles WHERE user_id = $1 FOR UPDATE", [userId]);
    const row = await tx.query(
      `INSERT INTO specialist_accreditations
         (user_id, revision, kind, photo_mime, photo_data, document_mime, document_data, extra_references)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id) DO UPDATE SET revision = EXCLUDED.revision, kind = EXCLUDED.kind,
       photo_mime = EXCLUDED.photo_mime, photo_data = EXCLUDED.photo_data,
       document_mime = EXCLUDED.document_mime, document_data = EXCLUDED.document_data,
       extra_references = EXCLUDED.extra_references,
       status = 'pending', reason = NULL, submitted_at = NOW(), reviewed_at = NULL
       RETURNING ${metadata}`,
      [userId, randomUUID(), kind, photo.mime, photo.data, firstFile.mime, firstFile.data, JSON.stringify(extraReferences.map(({ mime, data }) => ({ mime, data })))]
    );
    await tx.query("UPDATE professional_profiles SET verified = FALSE WHERE user_id = $1", [userId]);
    return row.rows[0];
  });
  res.status(201).json(result);
}));

accreditationRouter.get("/review", ...reviewerOnly, safe(async (_req, res) => {
  const result = await db.query(
    `SELECT a.user_id, a.revision, a.kind, a.status, a.reason, a.submitted_at, a.reviewed_at,
            u.full_name, u.role
       FROM specialist_accreditations a JOIN users u ON u.id = a.user_id
       ORDER BY (a.status = 'pending') DESC, a.submitted_at DESC LIMIT 100`
  );
  res.json(result.rows);
}));

accreditationRouter.get("/files/:userId/:revision/:part", requireAuth, safe(async (req, res) => {
  const { userId, revision, part } = req.params;
  if (req.user!.role !== "admin" && req.user!.id !== userId) {
    res.sendStatus(403);
    return;
  }
  const extraIndex = part === "reference-2" ? 0 : part === "reference-3" ? 1 : null;
  if (part !== "photo" && part !== "document" && extraIndex === null) {
    res.sendStatus(404);
    return;
  }
  const columns = part === "photo" ? "photo_mime AS mime, photo_data AS data"
    : "document_mime AS mime, document_data AS data";
  const result = extraIndex === null
    ? await db.query(`SELECT ${columns} FROM specialist_accreditations WHERE user_id = $1 AND revision::text = $2`, [userId, revision])
    : await db.query(
      `SELECT extra_references -> $3::int ->> 'mime' AS mime,
              extra_references -> $3::int ->> 'data' AS data
       FROM specialist_accreditations WHERE user_id = $1 AND revision::text = $2 AND kind = 'referencias'`,
      [userId, revision, extraIndex]
    );
  const file = result.rows[0];
  if (!file?.data) {
    res.sendStatus(404);
    return;
  }
  const extension = file.mime === "application/pdf" ? "pdf" : file.mime === "image/png" ? "png" : "jpg";
  res.setHeader("Content-Disposition", `attachment; filename="${part}.${extension}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.type(file.mime).send(Buffer.from(file.data, "base64"));
}));

accreditationRouter.patch("/review/:userId", ...reviewerOnly, safe(async (req, res) => {
  const { userId } = req.params;
  const { revision, decision, reason } = req.body;
  const notes = typeof reason === "string" ? reason.trim() : "";
  if (typeof revision !== "string" || !["approved", "rejected"].includes(decision) ||
      (decision === "rejected" && (!notes || notes.length > 500))) {
    res.status(400).json({ error: "Indica una decisión válida y el motivo si rechazas la acreditación." });
    return;
  }
  const reviewed = await db.transaction(async tx => {
    await tx.query("SELECT user_id FROM professional_profiles WHERE user_id = $1 FOR UPDATE", [userId]);
    const result = await tx.query(
      `UPDATE specialist_accreditations SET status = $3, reason = $4, reviewed_at = NOW()
       WHERE user_id = $1 AND revision::text = $2 AND status = 'pending'
       RETURNING photo_mime, photo_data`,
      [userId, revision, decision, decision === "rejected" ? notes : null]
    );
    if (!result.rows.length) return false;
    const approved = decision === "approved";
    await tx.query("UPDATE professional_profiles SET verified = $2 WHERE user_id = $1", [userId, approved]);
    if (approved) {
      const photo = result.rows[0];
      await tx.query("UPDATE users SET avatar_url = $2, updated_at = NOW() WHERE id = $1",
        [userId, `data:${photo.photo_mime};base64,${photo.photo_data}`]);
    }
    await tx.query(
      `INSERT INTO audit_logs (id, actor_id, event_type, target_table, target_id, details)
       VALUES ($1, $2, 'PRO_VERIFICATION_STATUS_CHANGED', 'professional_profiles', $3, $4)`,
      [`aud_${randomUUID()}`, req.user!.id, userId, JSON.stringify({ revision, decision })]
    );
    return true;
  });
  if (!reviewed) {
    res.status(409).json({ error: "La solicitud cambió o ya fue revisada. Actualiza la lista." });
    return;
  }
  res.json({ status: decision });
}));
