import { Router, Response } from "express";
import crypto from "crypto";
import { db } from "../db/index.ts";
import { requireAuth, requireRole, AuthenticatedRequest } from "../middleware/auth.ts";

export const adminRouter = Router();

// Protect all admin endpoints with admin role check
adminRouter.use(requireAuth, requireRole("admin"));

// GET /api/v1/admin/metrics
adminRouter.get("/metrics", async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const totalUsers = await db.query("SELECT COUNT(*) as count FROM users;");
    const totalPros = await db.query("SELECT COUNT(*) as count FROM professional_profiles WHERE verified = TRUE;");
    const totalRequests = await db.query("SELECT COUNT(*) as count FROM service_requests;");
    const activeContracts = await db.query("SELECT COUNT(*) as count FROM contracts WHERE status IN ('held_in_escrow', 'active_in_transit', 'in_progress');");
    const openDisputes = await db.query("SELECT COUNT(*) as count FROM disputes WHERE status IN ('open', 'under_review');");
    const totalEscrowLocked = await db.query("SELECT COALESCE(SUM(amount), 0) as total FROM escrow_holds WHERE status = 'locked';");
    const totalCommissionEarned = await db.query("SELECT COALESCE(SUM(amount), 0) as total FROM financial_transactions WHERE type = 'fee_deduction';");

    res.json({
      totalUsers: parseInt(totalUsers.rows[0].count, 10),
      verifiedProfessionals: parseInt(totalPros.rows[0].count, 10),
      totalRequests: parseInt(totalRequests.rows[0].count, 10),
      activeContracts: parseInt(activeContracts.rows[0].count, 10),
      openDisputes: parseInt(openDisputes.rows[0].count, 10),
      escrowLockedRD: parseFloat(totalEscrowLocked.rows[0].total),
      platformEarningsRD: parseFloat(totalCommissionEarned.rows[0].total),
      timestamp: new Date().toISOString()
    });
  } catch {
    res.status(500).json({ error: "Error al recopilar métricas operativas" });
  }
});

adminRouter.get("/operations", async (req, res) => {
  const page = Number(req.query.page ?? 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000) {
    res.status(400).json({ error: "Página inválida." });
    return;
  }

  try {
    const result = await db.query(
      `WITH commissions AS (
         SELECT contract_id, SUM(amount::numeric) AS amount
         FROM financial_transactions WHERE type = 'fee_deduction' AND status = 'completed'
         GROUP BY contract_id
       ), services AS (
         SELECT c.id, c.created_at, c.status, c.agreed_price, c.commission_rate,
                c.platform_fee AS agreed_commission, COALESCE(f.amount, 0) AS recorded_commission,
                sr.title, cl.full_name AS client, sp.full_name AS specialist,
                sp.id AS specialist_id, sp.role AS specialist_role
         FROM contracts c
         JOIN service_requests sr ON sr.id = c.request_id
         JOIN users cl ON cl.id = c.client_id
         JOIN users sp ON sp.id = c.professional_id
         LEFT JOIN commissions f ON f.contract_id = c.id
       ), recent AS (
         SELECT * FROM services
         ORDER BY CASE WHEN status IN ('held_in_escrow','active_in_transit','in_progress') THEN 0 ELSE 1 END,
                  created_at DESC, id DESC
         LIMIT 25 OFFSET $1
       ), by_specialist AS (
         SELECT specialist_id, specialist, specialist_role, COUNT(*) AS services,
                COUNT(*) FILTER (WHERE status IN ('held_in_escrow','active_in_transit','in_progress')) AS active,
                SUM(recorded_commission) AS recorded_commission
         FROM services GROUP BY specialist_id, specialist, specialist_role
         ORDER BY active DESC, recorded_commission DESC, specialist_id
         LIMIT 25 OFFSET $1
       )
       SELECT
         (SELECT COUNT(*) FROM service_requests) AS requests,
         (SELECT COUNT(*) FROM services) AS contracts,
         (SELECT COUNT(DISTINCT specialist_id) FROM services WHERE status IN ('active_in_transit','in_progress')) AS operating,
         (SELECT COUNT(*) FROM services WHERE status IN ('held_in_escrow','active_in_transit','in_progress')) AS active,
         (SELECT COUNT(*) FROM services WHERE status = 'completed') AS completed,
         (SELECT COALESCE(SUM(agreed_price::numeric), 0) FROM services WHERE status = 'completed') AS completed_value,
         (SELECT COALESCE(SUM(amount), 0) FROM commissions) AS recorded_commission,
         (SELECT COALESCE(SUM(platform_earnings::numeric), 0) FROM contract_cancellations) AS cancellation_income,
         (SELECT COALESCE(SUM(amount), 0) FROM commissions) +
         (SELECT COALESCE(SUM(platform_earnings::numeric), 0) FROM contract_cancellations) AS platform_income,
         (SELECT COALESCE(SUM(amount::numeric), 0) FROM escrow_holds WHERE status = 'locked') AS held,
         (SELECT COUNT(DISTINCT specialist_id) FROM services) AS specialist_count,
         (SELECT COALESCE(json_agg(recent), '[]'::json) FROM recent) AS services,
         (SELECT COALESCE(json_agg(by_specialist), '[]'::json) FROM by_specialist) AS specialists`,
      [(page - 1) * 25],
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ ...result.rows[0], currency: "DOP", updated_at: new Date().toISOString() });
  } catch {
    res.status(500).json({ error: "No se pudo cargar el panel de operaciones." });
  }
});

// Operational journal derived from recorded movements. Bank cash requires separate reconciliation.
adminRouter.get("/accounting", async (req, res) => {
  const page = Number(req.query.page ?? 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000) {
    res.status(400).json({ error: "Página inválida." });
    return;
  }
  try {
    const result = await db.query(
      `WITH entries AS (
        SELECT id, contract_id, created_at, type, ROUND(amount::numeric, 2) AS amount
        FROM financial_transactions
        WHERE status = 'completed' AND contract_id IS NOT NULL AND amount > 0
          AND type IN ('escrow_hold','escrow_release','fee_deduction','refund','penalty')
        UNION ALL
        SELECT id, contract_id, created_at, 'cancellation_income', ROUND(platform_earnings::numeric, 2)
        FROM contract_cancellations WHERE platform_earnings > 0
      ), recent AS (
        SELECT * FROM entries ORDER BY created_at DESC, id DESC LIMIT 25 OFFSET $1
      )
      SELECT
        (SELECT COUNT(*) FROM entries) AS entry_count,
        (SELECT COALESCE(json_agg(recent ORDER BY created_at DESC, id DESC), '[]'::json) FROM recent) AS entries,
        (SELECT COALESCE(SUM(amount),0) FROM entries WHERE type = 'fee_deduction') AS commission,
        (SELECT COALESCE(SUM(amount),0) FROM entries WHERE type = 'cancellation_income') AS cancellation_income,
        (SELECT COALESCE(SUM(amount),0) FROM entries WHERE type IN ('escrow_release', 'penalty')) AS credited_to_specialists,
        (SELECT COALESCE(SUM(amount),0) FROM entries WHERE type = 'refund') AS refunded,
        (SELECT COALESCE(SUM(amount::numeric),0) FROM escrow_holds WHERE status = 'locked') AS held,
        (SELECT COALESCE(SUM(agreed_price::numeric),0) FROM contracts WHERE status = 'completed') AS completed_volume,
        (SELECT COUNT(*) FROM contracts WHERE status = 'completed') AS completed_count`,
      [(page - 1) * 25],
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ ...result.rows[0], currency: "DOP", bank_pending: null, bank_confirmed: null, updated_at: new Date().toISOString() });
  } catch {
    res.status(500).json({ error: "No se pudo consultar el registro financiero." });
  }
});

// GET /api/v1/admin/users
adminRouter.get("/users", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { role, status } = req.query;
    let query = `
      SELECT u.id, u.email, u.role, u.status, u.full_name, u.phone, u.created_at,
             pp.trade, pp.verified, pp.rating, pp.review_count,
             wl.balance_available, wl.balance_locked_escrow
      FROM users u
      LEFT JOIN professional_profiles pp ON u.id = pp.user_id
      LEFT JOIN wallet_ledgers wl ON u.id = wl.user_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (role) {
      params.push(role);
      query += ` AND u.role = $${params.length}`;
    }

    if (status) {
      params.push(status);
      query += ` AND u.status = $${params.length}`;
    }

    query += " ORDER BY u.created_at DESC LIMIT 100;";

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: "Error al listar usuarios para administración" });
  }
});

// Retire the legacy shortcut that bypassed document review.
adminRouter.patch("/professionals/:id/verify", (_req, res) => {
  res.status(409).json({ error: "Usa el panel de acreditaciones para revisar los archivos." });
});

// PATCH /api/v1/admin/users/:id/status (Activate, suspend or ban a user account)
adminRouter.patch("/users/:id/status", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!["active", "pending_verification", "suspended", "banned"].includes(status)) {
      res.status(400).json({ error: "Estado de usuario inválido" });
      return;
    }
    if (id === req.user!.id) {
      res.status(400).json({ error: "No puedes modificar tu propio estado administrativo" });
      return;
    }

    const updated = await db.query(
      "UPDATE users SET status = $1, updated_at = NOW() WHERE id = $2;",
      [status, id]
    );
    if ((updated.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }

    await db.query(
      `INSERT INTO audit_logs (id, actor_id, event_type, target_table, target_id, details)
       VALUES ($1, $2, 'USER_STATUS_CHANGED', 'users', $3, $4);`,
      ["aud_" + crypto.randomUUID().slice(0, 12), req.user!.id, id, JSON.stringify({ status })]
    );

    res.json({ message: "Estado de usuario actualizado correctamente", userId: id, status });
  } catch {
    res.status(500).json({ error: "Error al actualizar estado del usuario" });
  }
});

// GET /api/v1/admin/disputes
adminRouter.get("/disputes", async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await db.query(
      `SELECT d.*,
              c.agreed_price, c.client_id, c.professional_id, c.status as contract_status,
              sr.title as request_title,
              cu.full_name as client_name, pu.full_name as pro_name
       FROM disputes d
       JOIN contracts c ON d.contract_id = c.id
       JOIN service_requests sr ON c.request_id = sr.id
       JOIN users cu ON c.client_id = cu.id
       JOIN users pu ON c.professional_id = pu.id
       ORDER BY d.created_at DESC
       LIMIT 100;`
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: "Error al consultar disputas y reclamaciones" });
  }
});

// POST /api/v1/admin/disputes/:id/resolve
adminRouter.post("/disputes/:id/resolve", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { decision, notes } = req.body; // 'refund_client' | 'release_pro'

    if (decision !== "refund_client" && decision !== "release_pro") {
      res.status(400).json({ error: "Decisión inválida. Use 'refund_client' o 'release_pro'" });
      return;
    }

    const disputeRes = await db.query("SELECT * FROM disputes WHERE id = $1;", [id]);
    if (disputeRes.rows.length === 0) {
      res.status(404).json({ error: "Disputa no encontrada" });
      return;
    }

    const dispute = disputeRes.rows[0];
    if (dispute.status === "resolved_refund_client" || dispute.status === "resolved_release_pro") {
      res.status(409).json({ error: "Esta disputa ya fue resuelta previamente" });
      return;
    }

    const contractRes = await db.query("SELECT * FROM contracts WHERE id = $1;", [dispute.contract_id]);
    if (contractRes.rows.length === 0) {
      res.status(404).json({ error: "Contrato asociado no encontrado" });
      return;
    }
    const contract = contractRes.rows[0];
    const resolutionNotes = String(notes || `Resolución administrativa Diclik.com (${decision})`).trim();

    await db.transaction(async (tx) => {
      const nextStatus = decision === "refund_client" ? "resolved_refund_client" : "resolved_release_pro";
      const updated = await tx.query(
        `UPDATE disputes SET status = $1, resolution_notes = $2, resolved_by = $3, resolved_at = NOW()
         WHERE id = $4 AND status IN ('open', 'under_review') RETURNING id;`,
        [nextStatus, resolutionNotes, req.user!.id, id]
      );
      if (!updated.rows.length) throw new Error("DISPUTE_STATE_CHANGED");
      if (decision === "refund_client") {
        await tx.query("UPDATE contracts SET status = 'cancelled' WHERE id = $1;", [contract.id]);
        await tx.query("UPDATE service_requests SET status = 'cancelled', updated_at = NOW() WHERE id = $1;", [contract.request_id]);
        await tx.query(
          "UPDATE escrow_holds SET status = 'refunded_to_client', refunded_at = NOW(), reason = $1 WHERE contract_id = $2;",
          [resolutionNotes, contract.id]
        );
        await tx.query(
          `UPDATE wallet_ledgers
           SET balance_locked_escrow = GREATEST(0, balance_locked_escrow - $1),
               balance_available = balance_available + $1,
               updated_at = NOW()
           WHERE user_id = $2;`,
          [contract.agreed_price, contract.client_id]
        );
        await tx.query(
          `INSERT INTO financial_transactions (id, user_id, contract_id, type, amount, status, idempotency_key, description)
           VALUES ($1, $2, $3, 'refund', $4, 'completed', $5, $6);`,
          [
            "tx_" + crypto.randomUUID().slice(0, 12),
            contract.client_id,
            contract.id,
            contract.agreed_price,
            "idem_dispute_refund_" + id,
            `Reembolso total por resolución de disputa (${id}): ${resolutionNotes}`
          ]
        );
      } else {
        await tx.query("UPDATE contracts SET status = 'completed', completed_at = NOW() WHERE id = $1;", [contract.id]);
        await tx.query("UPDATE service_requests SET status = 'completed', updated_at = NOW() WHERE id = $1;", [contract.request_id]);
        await tx.query(
          "UPDATE escrow_holds SET status = 'released_to_pro', released_at = NOW(), reason = $1 WHERE contract_id = $2;",
          [resolutionNotes, contract.id]
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
           VALUES ($1, $2, $3, 'escrow_release', $4, 'completed', $5, $6);`,
          [
            "tx_" + crypto.randomUUID().slice(0, 12),
            contract.professional_id,
            contract.id,
            contract.professional_payout,
            "idem_dispute_release_" + id,
            `Liberación Escrow tras resolución de disputa (${id})`
          ]
        );
        await tx.query(
          `INSERT INTO financial_transactions (id, user_id, contract_id, type, amount, status, idempotency_key, description)
           VALUES ($1, NULL, $2, 'fee_deduction', $3, 'completed', $4, $5);`,
          [
            "tx_" + crypto.randomUUID().slice(0, 12),
            contract.id,
            contract.platform_fee,
            "idem_dispute_fee_" + id,
            "Comisión de plataforma Diclik.com por resolución de disputa"
          ]
        );
      }

      await tx.query(
        `INSERT INTO audit_logs (id, actor_id, event_type, target_table, target_id, details)
         VALUES ($1, $2, 'DISPUTE_RESOLVED', 'disputes', $3, $4);`,
        ["aud_" + crypto.randomUUID().slice(0, 12), req.user!.id, id, JSON.stringify({ decision, notes: resolutionNotes })]
      );
    });

    res.json({ message: "Disputa resuelta y fondos conciliados en PostgreSQL", decision, disputeId: id });
  } catch (error: any) {
    if (error?.message === "DISPUTE_STATE_CHANGED") {
      res.status(409).json({ error: "El estado de la disputa cambió antes de resolverla." });
      return;
    }
    console.error("[Admin Resolve Dispute Error]:", error?.message);
    res.status(500).json({ error: "Error al resolver la disputa" });
  }
});

// GET /api/v1/admin/audit-logs
adminRouter.get("/audit-logs", async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await db.query(
      `SELECT al.*, u.email as actor_email, u.full_name as actor_name
       FROM audit_logs al
       LEFT JOIN users u ON al.actor_id = u.id
       ORDER BY al.created_at DESC
       LIMIT 100;`
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: "Error al consultar bitácora de auditoría" });
  }
});
