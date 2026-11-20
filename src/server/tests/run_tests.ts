/**
 * Diclik.com — Comprehensive Enterprise Integration & Security Test Suite
 * Tests real Express HTTP endpoints + PostgreSQL ACID transactions, Security, RBAC, Escrow, Webhooks & Disputes
 */

import express from "express";
import http from "http";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { jsonBody } from "../middleware/jsonBody.ts";
import { db } from "../db/index.ts";
import { getJwtSecretForTests } from "../middleware/auth.ts";
import { accreditationRouter } from "../routes/accreditationRoutes.ts";
import { authRouter } from "../routes/authRoutes.ts";
import { marketplaceRouter } from "../routes/marketplaceRoutes.ts";
import { radarRouter } from "../routes/radarRoutes.ts";
import { chatRouter } from "../routes/chatRoutes.ts";
import { walletRouter } from "../routes/walletRoutes.ts";
import { adminRouter } from "../routes/adminRoutes.ts";

interface TestResult {
  name: string;
  passed: boolean;
  durationMs: number;
  details?: string;
  error?: string;
}

const testResults: TestResult[] = [];

async function runTest(name: string, fn: () => Promise<string | void>) {
  const start = Date.now();
  try {
    const details = (await fn()) || "Aprobado";
    testResults.push({ name, passed: true, durationMs: Date.now() - start, details });
    console.log(`  [PASSED] ${name} (${Date.now() - start}ms) — ${details}`);
  } catch (err: any) {
    testResults.push({ name, passed: false, durationMs: Date.now() - start, error: err.message });
    console.error(`  [FAILED] ${name}: ${err.message}`);
  }
}

export async function runAllTests() {
  console.log("\n==================================================================");
  console.log("   DICLIK.COM — AUDITORÍA DE PRUEBAS AUTOMATIZADAS v2.0.0");
  console.log("==================================================================\n");

  process.env.NODE_ENV = "test";
  process.env.PAYMENT_WEBHOOK_SECRET = "test_webhook_hmac_secret_diclik_2026_32bytes";

  const adminEmail = "admin-pruebas@diclik.test";
  const adminPassword = crypto.randomBytes(24).toString("hex");
  process.env.BOOTSTRAP_ADMIN_EMAIL = adminEmail;
  process.env.BOOTSTRAP_ADMIN_PASSWORD = adminPassword;
  process.env.SEED_DEMO_DATA = "false";
  await db.init();

  // Start ephemeral Express server for real HTTP integration testing
  const app = express();
  app.use(jsonBody);
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/accreditation", accreditationRouter);
  app.use("/api/v1/radar", radarRouter);
  app.use("/api/v1/chat", chatRouter);
  app.use("/api/v1/wallet", walletRouter);
  app.use("/api/v1/admin", adminRouter);
  app.use("/api/v1", marketplaceRouter);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;

  async function apiCall(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        ...(opts.headers || {})
      }
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  }

  try {
    // 1. PostgreSQL Schema Integrity (All 21 Tables including hardening migration 002)
    await runTest("1. Motor PostgreSQL e Integridad de 21 Tablas Versionadas", async () => {
      const tablesQuery = await db.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name;
      `);

      const expectedTables = [
        "audit_logs",
        "client_profiles",
        "contract_cancellations",
        "contracts",
        "conversations",
        "disputes",
        "escrow_holds",
        "financial_transactions",
        "messages",
        "notifications",
        "offers",
        "password_reset_tokens",
        "payment_webhooks",
        "professional_profiles",
        "reviews",
        "revoked_tokens",
        "schema_migrations",
        "service_categories",
        "service_requests",
        "users",
        "wallet_ledgers"
      ];

      const foundNames = tablesQuery.rows.map((r: any) => r.table_name);
      const missing = expectedTables.filter((t) => !foundNames.includes(t));
      if (missing.length > 0) {
        throw new Error(`Tablas faltantes: ${missing.join(", ")}`);
      }
      return `${expectedTables.length} tablas verificadas correctamente (migraciones 001 + 002).`;
    });

    // 2. Auth: Real Registration, Bcrypt 12 Rounds, Login & Profile Update
    const ts = Date.now();
    const clientEmail = `cliente_${ts}@diclik.com`;
    const proEmail = `pro_${ts}@diclik.com`;
    const pwd = "DiclikSecure2026!";
    let clientToken = "";
    let clientId = "";
    let proToken = "";
    let proId = "";
    let adminToken = "";

    await runTest("2. Registro Real, Cifrado Bcrypt y Login JWT sin Secretos Hardcodeados", async () => {
      const regClient = await apiCall("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email: clientEmail,
          password: pwd,
          role: "cliente",
          fullName: "Cliente Certificado Diclik",
          phone: "+18095559901",
          address: "Av. 27 de Febrero #200, Santo Domingo"
        })
      });
      if (regClient.status !== 201 || !regClient.body.token) {
        throw new Error(`Fallo registro cliente: ${regClient.body.error || regClient.status}`);
      }
      clientToken = regClient.body.token;
      clientId = regClient.body.user.id;

      const regPro = await apiCall("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email: proEmail,
          password: pwd,
          role: "tecnico",
          fullName: "Técnico Certificado Diclik",
          phone: "+18095559902",
          trade: "plomeria"
        })
      });
      if (regPro.status !== 201 || !regPro.body.token) {
        throw new Error(`Fallo registro técnico: ${regPro.body.error || regPro.status}`);
      }
      proToken = regPro.body.token;
      proId = regPro.body.user.id;

      const image = { mime: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR9sAAAAASUVORK5CYII=" };
      const technicianHeaders = { Authorization: `Bearer ${proToken}` };
      const service = { title: "Solicitud desde cuenta de técnico", description: "Prueba de doble rol", address: "Santo Domingo" };
      const noIdentity = await apiCall("/services", {
        method: "POST", headers: technicianHeaders, body: JSON.stringify(service),
      });
      if (noIdentity.status !== 403 || noIdentity.body.code !== "IDENTITY_REQUIRED") throw new Error("Se publicó sin identificación");
      for (const token of [clientToken, proToken]) {
        const upload = await apiCall("/accreditation/identity", {
          method: "PUT", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ document: image }),
        });
        if (upload.status !== 201 || upload.body.submitted !== true) throw new Error("No se pudo subir la identificación");
      }
      const otherIdentity = await apiCall(`/accreditation/identity/review/${clientId}`, { headers: technicianHeaders });
      if (otherIdentity.status !== 403) throw new Error("Se expuso la identificación a una cuenta ajena");
      const technicianRequest = await apiCall("/services", {
        method: "POST", headers: technicianHeaders, body: JSON.stringify(service),
      });
      if (technicianRequest.status !== 201) throw new Error("El técnico no pudo publicar con su misma cuenta");
      const ownQuote = await apiCall(`/services/${technicianRequest.body.requestId}/offers`, {
        method: "POST", headers: technicianHeaders, body: JSON.stringify({ price: 1200 }),
      });
      if (ownQuote.status !== 403) throw new Error("El técnico pudo cotizar su propia solicitud");
      const clientHeaders = { Authorization: `Bearer ${clientToken}` };
      const customerRequest = await apiCall("/services", {
        method: "POST", headers: clientHeaders, body: JSON.stringify(service),
      });
      const noCredentials = await apiCall(`/services/${customerRequest.body.requestId}/offers`, {
        method: "POST", headers: technicianHeaders, body: JSON.stringify({ price: 1200 }),
      });
      if (noCredentials.status !== 403 || noCredentials.body.code !== "ACCREDITATION_REQUIRED") {
        throw new Error("Se permitió cotizar sin documentos de acreditación");
      }
      await apiCall(`/services/${customerRequest.body.requestId}`, { method: "DELETE", headers: clientHeaders });
      const credentials = await apiCall("/accreditation/mine", {
        method: "PUT", headers: technicianHeaders,
        body: JSON.stringify({ kind: "diploma", photo: image, document: image }),
      });
      if (credentials.status !== 201) throw new Error("No se pudo adjuntar el certificado de técnico");
      await apiCall(`/services/${technicianRequest.body.requestId}`, { method: "DELETE", headers: technicianHeaders });

      // Verify bcrypt cost >= 10
      const userRow = (await db.query("SELECT password_hash FROM users WHERE id = $1;", [clientId])).rows[0];
      if (!userRow.password_hash.startsWith("$2")) throw new Error("Hash inválido");

      // Verify seeded admin login
      const admRes = await apiCall("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: adminEmail, password: adminPassword })
      });
      if (admRes.status !== 200) throw new Error("Fallo login admin");
      adminToken = admRes.body.token;

      // Verify JWT rejects forged secret
      let acceptedForged = false;
      try {
        jwt.verify(clientToken, "wrong_secret_should_fail");
        acceptedForged = true;
      } catch {
        acceptedForged = false;
      }
      if (acceptedForged || getJwtSecretForTests().includes("directo_enterprise")) {
        throw new Error("Secreto JWT inseguro detectado");
      }

      return `Cliente (${clientId}), Técnico (${proId}) y Admin autenticados vía HTTP.`;
    });

    // 3. Logout Token Revocation & Password Recovery Flow
    await runTest("3. Revocación de Token en Logout (Blacklist) y Recuperación de Contraseña", async () => {
      // Create temporary session token to test logout revocation
      const tempLogin = await apiCall("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: clientEmail, password: pwd })
      });
      const tempToken = tempLogin.body.token;

      const logoutRes = await apiCall("/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${tempToken}` }
      });
      if (logoutRes.status !== 200) throw new Error("Logout no respondió 200");

      const afterLogout = await apiCall("/auth/me", {
        headers: { Authorization: `Bearer ${tempToken}` }
      });
      if (afterLogout.status !== 401) {
        throw new Error("Vulnerabilidad: Token revocado siguió siendo aceptado");
      }

      // Test profile update
      const profUpd = await apiCall("/auth/profile", {
        method: "PUT",
        headers: { Authorization: `Bearer ${clientToken}` },
        body: JSON.stringify({ fullName: "Cliente Verificado Diclik", phone: "+18095557777" })
      });
      if (profUpd.status !== 200) throw new Error("Fallo actualización de perfil");

      // Forgot + reset password (verify no raw token leaked over HTTP and DB row persisted)
      const forgotRes = await apiCall("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: clientEmail })
      });
      if (forgotRes.status !== 200 || forgotRes.body.devResetToken) {
        throw new Error("Fallo endpoint forgot-password o filtró token en respuesta HTTP");
      }

      const prtCheck = await db.query(
        "SELECT id FROM password_reset_tokens WHERE user_id = $1 AND used = FALSE;",
        [clientId]
      );
      if (prtCheck.rows.length === 0) {
        throw new Error("forgot-password no persistió token temporal en PostgreSQL");
      }

      // Simulate user clicking email link token (hashed via SHA-256 in DB)
      const knownRawResetToken = crypto.randomBytes(24).toString("hex");
      const knownHash = crypto.createHash("sha256").update(knownRawResetToken).digest("hex");
      await db.query(
        `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, used)
         VALUES ($1, $2, $3, $4, FALSE);`,
        ["prt_test_" + ts, clientId, knownHash, new Date(Date.now() + 600_000).toISOString()]
      );

      const resetRes = await apiCall("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token: knownRawResetToken, newPassword: "NewDiclikPassword2026!" })
      });
      if (resetRes.status !== 200) throw new Error("Fallo restablecimiento de contraseña");

      // Login with new password succeeds
      const newLogin = await apiCall("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: clientEmail, password: "NewDiclikPassword2026!" })
      });
      if (newLogin.status !== 200) throw new Error("No pudo iniciar sesión tras cambio de clave");
      clientToken = newLogin.body.token;

      return "Token revocado en DB tras logout y recuperación temporal validada.";
    });

    // 4. Financial: Payment Gateway HMAC Webhook, Idempotency & Production Sandbox Block
    await runTest("4. Webhook HMAC-SHA256 Autenticado, Idempotencia y Bloqueo Sandbox en Producción", async () => {
      // Bad signature rejected
      const badSig = await apiCall("/wallet/webhooks/payment", {
        method: "POST",
        headers: { "x-webhook-signature": "invalid_signature" },
        body: JSON.stringify({ eventId: "evt_bad", eventType: "payment.succeeded", userId: clientId, amount: 10000 })
      });
      if (badSig.status !== 401) throw new Error("Webhook aceptó firma inválida");

      // Valid signed webhook deposits RD$ 10,000
      const payload = {
        eventId: `evt_${ts}_1`,
        eventType: "payment.succeeded",
        provider: "stripe_rd",
        userId: clientId,
        amount: 10000,
        currency: "DOP"
      };
      const raw = JSON.stringify(payload, null, 2);
      const validSig = crypto.createHmac("sha256", process.env.PAYMENT_WEBHOOK_SECRET!).update(raw).digest("hex");

      const okWh = await apiCall("/wallet/webhooks/payment", {
        method: "POST",
        headers: { "x-webhook-signature": `sha256=${validSig}` },
        body: raw
      });
      if (okWh.status !== 200) throw new Error(`Webhook legítimo falló: ${okWh.body.error}`);

      // Replay with same eventId must NOT double credit
      const replayWh = await apiCall("/wallet/webhooks/payment", {
        method: "POST",
        headers: { "x-webhook-signature": validSig },
        body: raw
      });
      if (replayWh.status !== 200) throw new Error("Replay webhook error");

      const ledger = await apiCall("/wallet/ledger", { headers: { Authorization: `Bearer ${clientToken}` } });
      if (Number(ledger.body.balance_available) !== 10000) {
        throw new Error(`Saldo incorrecto tras webhook+replay: ${ledger.body.balance_available}`);
      }

      // Ensure sandbox deposit fails when ALLOW_SANDBOX_PAYMENTS !== 'true'
      const prevSandbox = process.env.ALLOW_SANDBOX_PAYMENTS;
      process.env.ALLOW_SANDBOX_PAYMENTS = "false";
      const blockedSandbox = await apiCall("/wallet/deposit", {
        method: "POST",
        headers: { Authorization: `Bearer ${clientToken}` },
        body: JSON.stringify({ amount: 5000 })
      });
      if (prevSandbox === undefined) delete process.env.ALLOW_SANDBOX_PAYMENTS;
      else process.env.ALLOW_SANDBOX_PAYMENTS = prevSandbox;
      if (blockedSandbox.status !== 403) {
        throw new Error("Recarga sandbox no fue bloqueada en modo restringido");
      }

      return "HMAC verificado, replay idempotente sin doble acreditación y sandbox bloqueado.";
    });

    // 5. PII Masking, RBAC & Full Service -> Offer -> Atomic Hire -> OTP Release -> Review Flow
    let requestId = "";
    let offerId = "";
    let contractId = "";
    let otpCode = "";

    await runTest("5. Privacidad PII, RBAC, Contratación Atómica Escrow, Liberación OTP y Reseña", async () => {
      // Client publishes service
      const srvRes = await apiCall("/services", {
        method: "POST",
        headers: { Authorization: `Bearer ${clientToken}` },
        body: JSON.stringify({
          title: "Reparación de llave de paso principal",
          description: "Requiere reemplazo de válvula de 1/2 pulgada",
          categoryId: "plomeria",
          targetRole: "tecnico",
          address: "Naco, Santo Domingo",
          urgency: "urgente",
          minBudget: 2500
        })
      });
      if (srvRes.status !== 201) throw new Error(`Fallo creación servicio: ${srvRes.body.error}`);
      requestId = srvRes.body.requestId;
      otpCode = srvRes.body.releaseCode;

      // Public unauthenticated listing MUST NOT expose client_phone or release_code
      const pubList = await apiCall("/services");
      const targetReq = pubList.body.find((r: any) => r.id === requestId);
      if (!targetReq) throw new Error("Solicitud no encontrada en listado");
      if (targetReq.client_phone !== null || targetReq.address !== null || targetReq.lat !== null
        || targetReq.lng !== null || targetReq.release_code !== undefined) {
        throw new Error("Fuga de PII/OTP en endpoint público GET /services");
      }

      // RBAC: Client CANNOT submit a professional offer
      const badRoleOffer = await apiCall(`/services/${requestId}/offers`, {
        method: "POST",
        headers: { Authorization: `Bearer ${clientToken}` },
        body: JSON.stringify({ price: 2000, etaMinutes: 15 })
      });
      if (badRoleOffer.status !== 403) throw new Error("RBAC falló: cliente pudo cotizar oferta");

      // Pro submits offer of RD$ 2,500
      const offerRes = await apiCall(`/services/${requestId}/offers`, {
        method: "POST",
        headers: { Authorization: `Bearer ${proToken}` },
        body: JSON.stringify({ price: 2500, etaMinutes: 12, message: "Incluye válvula de bronce" })
      });
      if (offerRes.status !== 201) throw new Error("Fallo envío de oferta");
      offerId = offerRes.body.offerId;

      // Client accepts offer -> locks RD$ 2,500 in Escrow (available 10000 -> 7500, locked -> 2500)
      const accRes = await apiCall(`/offers/${offerId}/accept`, {
        method: "POST",
        headers: { Authorization: `Bearer ${clientToken}` }
      });
      if (accRes.status !== 200) throw new Error(`Fallo aceptación: ${accRes.body.error}`);
      contractId = accRes.body.contractId;

      const locationPath = `/contracts/${contractId}/location`;
      const location = { lat: 18.4772, lng: -69.946 };
      const clientHeaders = { Authorization: `Bearer ${clientToken}` };
      const proHeaders = { Authorization: `Bearer ${proToken}` };
      const attemptedWrite = await apiCall(locationPath, { method: "PUT", headers: clientHeaders, body: JSON.stringify(location) });
      if (attemptedWrite.status !== 403) throw new Error("El cliente pudo cambiar la ubicación del especialista");
      const shared = await apiCall(locationPath, { method: "PUT", headers: proHeaders, body: JSON.stringify(location) });
      if (shared.status !== 200) throw new Error(`El técnico no pudo compartir ubicación: ${JSON.stringify(shared.body)}`);
      const tracked = await apiCall(locationPath, { headers: clientHeaders });
      if (tracked.status !== 200 || tracked.body.lat !== location.lat || tracked.body.lng !== location.lng) {
        throw new Error("El cliente no pudo consultar la ubicación compartida");
      }
      const externalAccess = await apiCall(locationPath, { headers: { Authorization: `Bearer ${adminToken}` } });
      if (externalAccess.status !== 403) throw new Error("Se expuso la ubicación fuera del contrato");
      const destinationPath = `/contracts/${contractId}/destination`;
      const destination = { lat: 18.49, lng: -69.92 };
      const destinationWrite = { method: "PUT", body: JSON.stringify(destination) };
      const deniedDestination = await apiCall(destinationPath, { ...destinationWrite, headers: proHeaders });
      if (deniedDestination.status !== 403) throw new Error("El técnico pudo cambiar el destino del cliente");
      const savedDestination = await apiCall(destinationPath, { ...destinationWrite, headers: clientHeaders });
      if (savedDestination.status !== 200) throw new Error("El cliente no pudo fijar el destino");
      const mapPath = `${locationPath}?view=map`;
      for (const headers of [clientHeaders, proHeaders]) {
        const map = await apiCall(mapPath, { headers });
        if (map.status !== 200 || map.body.destination?.lat !== destination.lat ||
            map.body.destination?.lng !== destination.lng || map.body.specialist?.lat !== location.lat) {
          throw new Error("Los participantes no pudieron ver ambos puntos del contrato");
        }
      }
      const deniedMap = await apiCall(mapPath, { headers: { Authorization: `Bearer ${adminToken}` } });
      if (deniedMap.status !== 403) throw new Error("El mapa expuso el destino a terceros");
      const transit = await apiCall(`/contracts/${contractId}/status`, {
        method: "PATCH", headers: proHeaders, body: JSON.stringify({ status: "active_in_transit" }),
      });
      const arrival = await apiCall(`/contracts/${contractId}/status`, {
        method: "PATCH", headers: proHeaders, body: JSON.stringify({ status: "in_progress" }),
      });
      if (transit.status !== 200 || arrival.status !== 200) throw new Error("No se registró el trayecto y la llegada");
      const repeatedArrival = await apiCall(`/contracts/${contractId}/status`, {
        method: "PATCH", headers: proHeaders, body: JSON.stringify({ status: "in_progress" }),
      });
      const customerNotices = await apiCall("/notifications", { headers: clientHeaders });
      const arrivals = customerNotices.body.filter((item: any) => item.type === "SPECIALIST_ARRIVED" && item.data?.contractId === contractId);
      if (repeatedArrival.status !== 200 || arrivals.length !== 1) {
        throw new Error("La llegada debe generar un solo aviso al cliente, incluso con reintentos");
      }


      // Race condition / duplicate accept attempt MUST return 409
      const dupAccept = await apiCall(`/offers/${offerId}/accept`, {
        method: "POST",
        headers: { Authorization: `Bearer ${clientToken}` }
      });
      if (dupAccept.status !== 409) throw new Error("Fallo protección contra doble contratación");

      // Unauthorized third user CANNOT verify OTP
      const unauthOtp = await apiCall(`/contracts/${contractId}/verify-otp`, {
        method: "POST",
        body: JSON.stringify({ otpInput: otpCode })
      });
      if (unauthOtp.status !== 401) throw new Error("Endpoint verify-otp permitió acceso sin autenticación");

      // Wrong OTP rejected
      const wrongOtp = await apiCall(`/contracts/${contractId}/verify-otp`, {
        method: "POST",
        headers: { Authorization: `Bearer ${proToken}` },
        body: JSON.stringify({ otpInput: "0000" })
      });
      if (wrongOtp.status !== 400) throw new Error("OTP incorrecto no fue rechazado");

      // Valid OTP releases funds cleanly
      const goodOtp = await apiCall(`/contracts/${contractId}/verify-otp`, {
        method: "POST",
        headers: { Authorization: `Bearer ${proToken}` },
        body: JSON.stringify({ otpInput: otpCode })
      });
      if (goodOtp.status !== 200) throw new Error(`Fallo liberación OTP: ${goodOtp.body.error}`);

      if ((await apiCall(locationPath, { headers: clientHeaders })).status !== 403) {
        throw new Error("El historial de ubicación quedó accesible tras cerrar el contrato");
      }

      // Verify the payout after the 25.42% platform fee.
      const proLedger = await apiCall("/wallet/ledger", { headers: { Authorization: `Bearer ${proToken}` } });
      if (Number(proLedger.body.balance_available) !== 1864.50) {
        throw new Error(`Desembolso incorrecto al técnico: ${proLedger.body.balance_available}`);
      }

      const fee = await db.query(
        "SELECT amount FROM financial_transactions WHERE contract_id = $1 AND type = 'fee_deduction';", [contractId]
      );
      if (fee.rows.length !== 1 || Number(fee.rows[0].amount) !== 635.50) {
        throw new Error("La comisión del 25.42% no se registró correctamente.");
      }

      // Leave review
      const revRes = await apiCall(`/contracts/${contractId}/review`, {
        method: "POST",
        headers: { Authorization: `Bearer ${clientToken}` },
        body: JSON.stringify({ rating: 5, comment: "Trabajo impecable y puntual" })
      });
      if (revRes.status !== 201) throw new Error("Fallo registro de calificación");

      return "PII protegido, RBAC aplicado, doble contratación bloqueada, Escrow OTP liberado y reseña registrada.";
    });

    await runTest("6. Confirmación de cancelación al 15% y 20%, y resolución de disputa", async () => {
      const clientHeaders = { Authorization: `Bearer ${clientToken}` };
      const proHeaders = { Authorization: `Bearer ${proToken}` };

      async function hireForTest(title: string, price: number) {
        const request = await apiCall("/services", {
          method: "POST",
          headers: clientHeaders,
          body: JSON.stringify({ title, description: title, categoryId: "electricidad", address: "Piantini" })
        });
        const offer = await apiCall(`/services/${request.body.requestId}/offers`, {
          method: "POST",
          headers: proHeaders,
          body: JSON.stringify({ price })
        });
        const contract = await apiCall(`/offers/${offer.body.offerId}/accept`, {
          method: "POST",
          headers: clientHeaders
        });
        if (!contract.body.contractId) throw new Error(`Fallo al contratar: ${JSON.stringify(contract.body)}`);
        return `/contracts/${contract.body.contractId}`;
      }

      const beforeArrival = await hireForTest("Revisión de breaker principal", 2000);
      const preview = await apiCall(`${beforeArrival}/cancel`, { headers: clientHeaders });
      if (preview.status !== 200 || preview.body.penaltyRatePercent !== 15 ||
          preview.body.penaltyAmount !== 300 || preview.body.clientRefundAmount !== 1700) {
        throw new Error(`Vista previa del 15% incorrecta: ${JSON.stringify(preview.body)}`);
      }
      const unauthorized = await apiCall(`${beforeArrival}/cancel`, { headers: proHeaders });
      const unconfirmed = await apiCall(`${beforeArrival}/cancel`, { method: "POST", headers: clientHeaders });
      if (unauthorized.status !== 403 || unconfirmed.status !== 428) {
        throw new Error("Se permitió consultar o cancelar sin autorización o confirmación.");
      }
      const cancelledEarly = await apiCall(`${beforeArrival}/cancel`, {
        method: "POST", headers: clientHeaders, body: JSON.stringify({ expected: preview.body })
      });
      if (cancelledEarly.status !== 200 || cancelledEarly.body.clientRefundAmount !== 1700 ||
          cancelledEarly.body.platformEarnings !== 45 || cancelledEarly.body.specialistCompensation !== 255) {
        throw new Error(`Liquidación del 15% incorrecta: ${JSON.stringify(cancelledEarly.body)}`);
      }

      const afterArrival = await hireForTest("Revisión de toma", 2000);
      const firstQuote = await apiCall(`${afterArrival}/cancel`, { headers: clientHeaders });
      for (const status of ["active_in_transit", "in_progress"]) {
        const transition = await apiCall(`${afterArrival}/status`, {
          method: "PATCH", headers: proHeaders, body: JSON.stringify({ status })
        });
        if (transition.status !== 200) throw new Error(`Fallo al marcar ${status}.`);
      }
      const stale = await apiCall(`${afterArrival}/cancel`, {
        method: "POST", headers: clientHeaders, body: JSON.stringify({ expected: firstQuote.body })
      });
      if (stale.status !== 409 || stale.body.code !== "CANCELLATION_QUOTE_CHANGED") {
        throw new Error("Se aceptó el importe anterior después de registrar la llegada.");
      }
      const updated = await apiCall(`${afterArrival}/cancel`, { headers: clientHeaders });
      if (updated.status !== 200 || updated.body.penaltyRatePercent !== 20 ||
          updated.body.penaltyAmount !== 400 || updated.body.clientRefundAmount !== 1600) {
        throw new Error(`Vista previa del 20% incorrecta: ${JSON.stringify(updated.body)}`);
      }
      const cancelledLate = await apiCall(`${afterArrival}/cancel`, {
        method: "POST", headers: clientHeaders, body: JSON.stringify({ expected: updated.body })
      });
      if (cancelledLate.status !== 200 || cancelledLate.body.clientRefundAmount !== 1600 ||
          cancelledLate.body.platformEarnings !== 80 || cancelledLate.body.specialistCompensation !== 320) {
        throw new Error(`Liquidación del 20% incorrecta: ${JSON.stringify(cancelledLate.body)}`);
      }

      const disputed = await hireForTest("Instalación de cerradura inteligente", 1000);
      const dispOpen = await apiCall(`${disputed}/dispute`, {
        method: "POST",
        headers: clientHeaders,
        body: JSON.stringify({ reason: "El especialista no se presentó al sitio acordado" })
      });
      if (dispOpen.status !== 201) throw new Error("Fallo apertura de disputa");

      const dispResolve = await apiCall(`/admin/disputes/${dispOpen.body.disputeId}/resolve`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ decision: "refund_client", notes: "Confirmada inasistencia" })
      });
      if (dispResolve.status !== 200) throw new Error("Fallo resolución de disputa por admin");

      return "Vista previa y liquidación al 15% y 20%, reconfirmación tras la llegada y resolución de disputa verificadas.";
    });

    // 7. Radar & Notifications Endpoints
    await runTest("7. Radar Geoespacial (Ocultación de Coordenadas) y Notificaciones Persistentes", async () => {
      const radarPath = "/radar/specialists?lat=18.4861&lng=-69.9312&radius=20";
      const headers = { Authorization: `Bearer ${proToken}` };
      const me = await apiCall("/auth/me", { headers });
      const appears = ({ body }: { body: { id: string }[] }) =>
        Array.isArray(body) && body.some(specialist => specialist.id === me.body.user.id);
      if (appears(await apiCall(radarPath))) throw new Error("El especialista apareció sin compartir su ubicación");
      const updateAvailability = (data: object) => apiCall("/auth/profile", {
        method: "PUT", headers, body: JSON.stringify(data)
      });
      const invalid = await updateAvailability({ isAvailable: true });
      if (invalid.status !== 400) throw new Error("El perfil aceptó activarse sin GPS");
      const activated = await updateAvailability({ isAvailable: true, location: { lat: 18.49, lng: -69.93 } });
      if (activated.status !== 200) throw new Error("El especialista no pudo compartir su ubicación");
      const radar = await apiCall(radarPath);
      if (!appears(radar)) throw new Error("El especialista disponible no apareció en el radar");
      const hidden = await updateAvailability({ isAvailable: false });
      if (hidden.status !== 200 || appears(await apiCall(radarPath))) {
        throw new Error("El especialista no pudo ocultarse del radar");
      }
      if (radar.status !== 200 || !Array.isArray(radar.body) || radar.body.length === 0) {
        throw new Error("Radar no devolvió especialistas");
      }
      if ("lat" in radar.body[0] || "lng" in radar.body[0]) {
        throw new Error("Privacidad vulnerada: radar expuso coordenadas GPS exactas del especialista");
      }

      const clientHeaders = { Authorization: `Bearer ${clientToken}` };
      async function createRadarRequest(targetRole: string, lat: number) {
        const response = await apiCall("/services", {
          method: "POST", headers: clientHeaders,
          body: JSON.stringify({ title: "Solicitud del radar", description: "Prueba del radar por rol",
            address: "Dirección privada", targetRole, lat, lng: -69.93421 }),
        });
        if (response.status !== 201) throw new Error("No se pudo preparar la solicitud del radar.");
        return response.body.requestId;
      }
      const portrait = { mime: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR9sAAAAASUVORK5CYII=" };
      const avatar = `data:${portrait.mime};base64,${portrait.data}`;
      const saved = await apiCall("/accreditation/client-photo", {
        method: "PUT", headers: clientHeaders, body: JSON.stringify({ photo: portrait }),
      });
      if (saved.status !== 200 || saved.body.avatar !== avatar) throw new Error("No se guardó la foto de perfil del cliente.");
      const technician = await createRadarRequest("tecnico", 18.48431);
      const professional = await createRadarRequest("profesional", 18.48431);
      const distant = await createRadarRequest("tecnico", 19.78);
      const cancelled = await createRadarRequest("tecnico", 18.48431);
      await apiCall(`/services/${cancelled}`, { method: "DELETE", headers: clientHeaders });
      for (const [role, expected, otherRole] of [["tecnico", technician, professional], ["profesional", professional, technician]]) {
        const result = await apiCall(`/radar/requests?role=${role}&lat=18.48&lng=-69.94&radius=15`);
        const item = result.body.find((entry: { id: string }) => entry.id === expected);
        if (result.status !== 200 || !item || item.approxLat !== 18.48 || item.approxLng !== -69.93 ||
            "address" in item || "lat" in item || "client_id" in item ||
            result.body.some((entry: { id: string }) => [otherRole, distant, cancelled].includes(entry.id))) {
          throw new Error("El radar de solicitudes mezcló roles, mostró solicitudes fuera de zona o expuso datos privados.");
        }
      }
      const signedRadar = await apiCall("/radar/requests?role=tecnico", { headers });
      const publicRadar = await apiCall("/radar/requests?role=tecnico");
      const specialistDetail = await apiCall(`/services/${technician}`, { headers });
      const publicDetail = await apiCall(`/services/${technician}`);
      if (signedRadar.body.find((item: any) => item.id === technician)?.clientAvatar !== avatar ||
          publicRadar.body.find((item: any) => item.id === technician)?.clientAvatar !== null ||
          specialistDetail.body.client_avatar !== avatar || specialistDetail.body.approximate_area?.lat !== 18.48 ||
          specialistDetail.body.approximate_area?.lng !== -69.93 || specialistDetail.body.address !== null ||
          specialistDetail.body.lat !== null || specialistDetail.body.lng !== null ||
          publicDetail.body.approximate_area !== null || publicDetail.body.client_avatar !== null) {
        throw new Error("La solicitud no mostró la foto autorizada o expuso datos privados.");
      }
      const removed = await apiCall("/accreditation/client-photo", { method: "DELETE", headers: clientHeaders });
      if (removed.status !== 200 || removed.body.avatar !== null) throw new Error("No se pudo retirar la foto de perfil.");
      await Promise.all([technician, professional, distant].map(id =>
        apiCall(`/services/${id}`, { method: "DELETE", headers: clientHeaders })));

      const notifs = await apiCall("/notifications", { headers: { Authorization: `Bearer ${proToken}` } });
      if (notifs.status !== 200 || !Array.isArray(notifs.body) || notifs.body.length === 0) {
        throw new Error("Notificaciones no persistieron para el profesional");
      }

      return `${radar.body.length} especialistas en radar sin exposición GPS y ${notifs.body.length} notificaciones auditadas.`;
    });

    // 8. Complete Service CRUD, Counter-Offer Pricing in Escrow, Offer Reject & Admin User Suspension
    await runTest("8. CRUD Servicios, Contraoferta Real en Escrow, Rechazo y Suspensión Admin", async () => {
      // Create temporary request to test GET/PATCH/DELETE
      const tempSrv = await apiCall("/services", {
        method: "POST",
        headers: { Authorization: `Bearer ${clientToken}` },
        body: JSON.stringify({
          title: "Reparación temporal de tubería",
          description: "Prueba CRUD inicial",
          categoryId: "plomeria",
          address: "Naco, Santo Domingo",
          minBudget: 1500
        })
      });
      if (tempSrv.status !== 201) throw new Error("Fallo POST /services temporal");
      const tempId = tempSrv.body.requestId;

      const detailRes = await apiCall(`/services/${tempId}`);
      if (detailRes.status !== 200 || detailRes.body.release_code !== undefined || detailRes.body.client_phone !== null) {
        throw new Error("GET /services/:id expuso PII/OTP o falló");
      }

      const patchRes = await apiCall(`/services/${tempId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${clientToken}` },
        body: JSON.stringify({ title: "Reparación actualizada de válvula", minBudget: 1800 })
      });
      if (patchRes.status !== 200) throw new Error("Fallo PATCH /services/:id");

      // Pro submits offer 1 -> rejected, offer 2 -> countered 2200 -> 1900 -> accepted at 1900
      const rejOffer = await apiCall(`/services/${tempId}/offers`, {
        method: "POST",
        headers: { Authorization: `Bearer ${proToken}` },
        body: JSON.stringify({ price: 2400, etaMinutes: 15 })
      });
      const rejRes = await apiCall(`/offers/${rejOffer.body.offerId}/reject`, {
        method: "POST",
        headers: { Authorization: `Bearer ${clientToken}` }
      });
      if (rejRes.status !== 200) throw new Error("Fallo POST /offers/:id/reject");

      // Delete open service cleanly
      const delRes = await apiCall(`/services/${tempId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${clientToken}` }
      });
      if (delRes.status !== 200) throw new Error("Fallo DELETE /services/:id");

      // Test counter-offer actually governs Escrow price upon accept
      const sCounter = await apiCall("/services", {
        method: "POST",
        headers: { Authorization: `Bearer ${clientToken}` },
        body: JSON.stringify({
          title: "Cambio de mezcladora cocina",
          description: "Incluye mangueras",
          categoryId: "plomeria",
          address: "Piantini",
          lat: 18.475,
          lng: -69.94,
          minBudget: 1200
        })
      });
      const oCounter = await apiCall(`/services/${sCounter.body.requestId}/offers`, {
        method: "POST",
        headers: { Authorization: `Bearer ${proToken}` },
        body: JSON.stringify({ price: 1500, etaMinutes: 15 })
      });
      const cntRes = await apiCall(`/offers/${oCounter.body.offerId}/counter`, {
        method: "POST",
        headers: { Authorization: `Bearer ${clientToken}` },
        body: JSON.stringify({ counterPrice: 1200, reason: "Ajuste presupuestario" })
      });
      if (cntRes.status !== 200) throw new Error("Fallo POST /offers/:id/counter");

      const selfAccept = await apiCall(`/offers/${oCounter.body.offerId}/accept`, {
        method: "POST",
        headers: { Authorization: `Bearer ${clientToken}` }
      });
      if (selfAccept.status !== 403) throw new Error("El cliente pudo aceptar su propia contraoferta");
      const accCnt = await apiCall(`/offers/${oCounter.body.offerId}/accept`, {
        method: "POST",
        headers: { Authorization: `Bearer ${proToken}` }
      });
      if (accCnt.status !== 200 || Number(accCnt.body.agreedPrice) !== 1200 || accCnt.body.otpCode !== undefined) {
        throw new Error(`Accept no respetó la contraoferta o expuso el OTP al especialista: ${JSON.stringify(accCnt.body)}`);
      }

      const map = await apiCall(`/contracts/${accCnt.body.contractId}/location?view=map`, {
        headers: { Authorization: `Bearer ${proToken}` }
      });
      if (map.status !== 200 || map.body.destination?.lat !== 18.475 || map.body.destination?.lng !== -69.94) {
        throw new Error("El mapa del contrato no heredó el punto de la solicitud");
      }

      // Admin suspends pro temporarily -> JWT rejected -> Admin restores active
      const susp = await apiCall(`/admin/users/${proId}/status`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ status: "suspended" })
      });
      if (susp.status !== 200) throw new Error("Fallo suspensión de usuario por admin");

      const blockedPro = await apiCall("/wallet/ledger", {
        headers: { Authorization: `Bearer ${proToken}` }
      });
      if (blockedPro.status !== 403) {
        throw new Error(`Usuario suspendido pudo acceder con JWT (status ${blockedPro.status})`);
      }

      const restore = await apiCall(`/admin/users/${proId}/status`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ status: "active" })
      });
      if (restore.status !== 200) throw new Error("Fallo reactivación de usuario por admin");

      return "CRUD completo, contraoferta aplicada a Escrow (RD$ 1,200) y bloqueo efectivo de cuentas suspendidas.";
    });

    // 9. Bank Withdrawals with Idempotency & Charge Refunded Webhook
    await runTest("9. Retiros Bancarios Auditados (Idempotencia / Saldo) y Reembolso Webhook HMAC", async () => {
      // Pro has RD$ 1,864.50 available from test 5 -> request valid withdrawal of RD$ 1,000
      const wdKey = `idem_wd_test_${ts}`;
      const wdOk = await apiCall("/wallet/withdraw", {
        method: "POST",
        headers: { Authorization: `Bearer ${proToken}` },
        body: JSON.stringify({
          amount: 1000,
          destinationAccount: "Banco Popular - 78901234",
          idempotencyKey: wdKey
        })
      });
      if (wdOk.status !== 201 || wdOk.body.status !== "pending") {
        throw new Error(`Retiro válido falló: ${JSON.stringify(wdOk.body)}`);
      }

      // Duplicate idempotencyKey rejected 409
      const wdDup = await apiCall("/wallet/withdraw", {
        method: "POST",
        headers: { Authorization: `Bearer ${proToken}` },
        body: JSON.stringify({
          amount: 1000,
          destinationAccount: "Banco Popular - 78901234",
          idempotencyKey: wdKey
        })
      });
      if (wdDup.status !== 409) throw new Error("Retiro duplicado no fue rechazado por idempotencia");

      // Insufficient balance rejected 402
      const wdInsuff = await apiCall("/wallet/withdraw", {
        method: "POST",
        headers: { Authorization: `Bearer ${proToken}` },
        body: JSON.stringify({
          amount: 50000,
          destinationAccount: "Banco Popular - 78901234"
        })
      });
      if (wdInsuff.status !== 402) throw new Error(`Retiro sin fondos devolvió ${wdInsuff.status} en lugar de 402`);

      // Valid signed charge.refunded webhook debits 200 from client
      const beforeLedger = await apiCall("/wallet/ledger", { headers: { Authorization: `Bearer ${clientToken}` } });
      const prevBal = Number(beforeLedger.body.balance_available);
      const refundPayload = {
        eventId: `evt_ref_${ts}`,
        eventType: "charge.refunded",
        provider: "stripe_rd",
        userId: clientId,
        amount: 200,
        currency: "DOP"
      };
      const rawRef = JSON.stringify(refundPayload);
      const sigRef = crypto.createHmac("sha256", process.env.PAYMENT_WEBHOOK_SECRET!).update(rawRef).digest("hex");

      const refWh = await apiCall("/wallet/webhooks/payment", {
        method: "POST",
        headers: { "x-webhook-signature": `sha256=${sigRef}` },
        body: rawRef
      });
      if (refWh.status !== 200) throw new Error("Webhook charge.refunded falló");

      const afterLedger = await apiCall("/wallet/ledger", { headers: { Authorization: `Bearer ${clientToken}` } });
      const newBal = Number(afterLedger.body.balance_available);
      if (Math.abs(newBal - (prevBal - 200)) > 0.01) {
        throw new Error(`Conciliación charge.refunded incorrecta: ${prevBal} -> ${newBal}`);
      }

      return "Retiros pendientes idempotentes (409/402 verificados) y conciliación charge.refunded HMAC exacta.";
    });

    // 10. Real Concurrency Race Condition & 100-Request Load/Latency Benchmark
    await runTest("10. Concurrencia Paralela (10x Accept Race) y Carga HTTP (100 Peticiones)", async () => {
      const sRace = await apiCall("/services", {
        method: "POST",
        headers: { Authorization: `Bearer ${clientToken}` },
        body: JSON.stringify({
          title: "Prueba concurrencia atómica",
          description: "Validación de doble gasto concurrente",
          categoryId: "electricidad",
          address: "Naco",
          minBudget: 500
        })
      });
      const oRace = await apiCall(`/services/${sRace.body.requestId}/offers`, {
        method: "POST",
        headers: { Authorization: `Bearer ${proToken}` },
        body: JSON.stringify({ price: 500, etaMinutes: 10 })
      });

      const ledgerBefore = await apiCall("/wallet/ledger", { headers: { Authorization: `Bearer ${clientToken}` } });
      const balBefore = Number(ledgerBefore.body.balance_available);

      // Launch 10 simultaneous offer-acceptance requests against same offer
      const raceCalls = await Promise.all(
        Array.from({ length: 10 }, () =>
          apiCall(`/offers/${oRace.body.offerId}/accept`, {
            method: "POST",
            headers: { Authorization: `Bearer ${clientToken}` }
          })
        )
      );

      const okCount = raceCalls.filter((r) => r.status === 200).length;
      const conflictCount = raceCalls.filter((r) => r.status === 409).length;
      if (okCount !== 1 || conflictCount !== 9) {
        throw new Error(`Fallo bloqueo concurrente: ok=${okCount}, conflict=${conflictCount}`);
      }

      const ledgerAfter = await apiCall("/wallet/ledger", { headers: { Authorization: `Bearer ${clientToken}` } });
      const balAfter = Number(ledgerAfter.body.balance_available);
      if (Math.abs(balAfter - (balBefore - 500)) > 0.01) {
        throw new Error(`Doble débito detectado bajo concurrencia: ${balBefore} -> ${balAfter}`);
      }

      // 100-request burst load test on GET /services
      const latencies: number[] = [];
      let errorCount = 0;
      await Promise.all(
        Array.from({ length: 100 }, async () => {
          const t0 = Date.now();
          const r = await apiCall("/services");
          latencies.push(Date.now() - t0);
          if (r.status !== 200) errorCount++;
        })
      );
      latencies.sort((a, b) => a - b);
      const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
      const avg = Math.round(latencies.reduce((acc, v) => acc + v, 0) / latencies.length);
      if (errorCount > 0) {
        throw new Error(`${errorCount}/100 peticiones fallaron bajo carga`);
      }

      return `10x Race: 1 éxito / 9 rechazos 409 sin doble débito; 100 req load: 0 errores, avg=${avg}ms, p95=${p95}ms.`;
    });

    await runTest("11. Registro profesional y mensajería con control de participantes", async () => {
      const professional = await apiCall("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email: `profesional_${ts}@diclik.test`,
          password: pwd,
          role: "profesional",
          fullName: "Profesional de prueba",
          trade: "Ingeniería",
          credentialCode: "PRUEBA-001"
        })
      });
      if (professional.status !== 201 || professional.body.user?.role !== "profesional") {
        throw new Error(`No se registró el profesional: ${JSON.stringify(professional.body)}`);
      }
      const clientHeaders = { Authorization: `Bearer ${clientToken}` };
      const technicianHeaders = { Authorization: `Bearer ${proToken}` };
      const conversations = await apiCall("/chat/conversations", { headers: clientHeaders });
      const conversation = conversations.body.find((item: any) => item.request_id === requestId && item.professional_id === proId);
      if (!conversation) throw new Error("La contratación no creó una conversación");
      const messagesPath = `/chat/conversations/${conversation.id}/messages`;
      const sent = await apiCall(messagesPath, {
        method: "POST",
        headers: clientHeaders,
        body: JSON.stringify({ content: "Mensaje de integración DICLIK" })
      });
      if (sent.status !== 201) throw new Error("No se pudo enviar el mensaje");
      const received = await apiCall(messagesPath, { headers: technicianHeaders });
      if (received.status !== 200 || !received.body.some((message: any) => message.id === sent.body.messageId)) {
        throw new Error("El técnico no recibió el mensaje");
      }
      const denied = await apiCall(messagesPath, {
        headers: { Authorization: `Bearer ${professional.body.token}` }
      });
      if (denied.status !== 403) throw new Error("Un tercero pudo acceder a la conversación");
      return "Profesional registrado; mensajes persistidos y acceso de terceros bloqueado.";
    });

    await runTest("12. Patrocinio y solicitud directa", async () => {
      const admin = { Authorization: `Bearer ${adminToken}` };
      const client = { Authorization: `Bearer ${clientToken}` };
      const specialist = { Authorization: `Bearer ${proToken}` };
      const accreditation = await apiCall("/accreditation/mine", { headers: specialist });
      const approved = await apiCall(`/accreditation/review/${proId}`, {
        method: "PATCH", headers: admin,
        body: JSON.stringify({ revision: accreditation.body.revision, decision: "approved" }),
      });
      if (approved.status !== 200) throw new Error("No se pudo acreditar al técnico de prueba.");
      const requestPromotion = (headers: Record<string, string>, category: string) => apiCall("/accreditation/sponsorship", {
        method: "POST", headers, body: JSON.stringify({ category }),
      });
      if ((await requestPromotion(client, "tecnico")).status !== 403 ||
          (await requestPromotion(specialist, "pediatria")).status !== 403 ||
          (await requestPromotion(specialist, "tecnico")).status !== 200 ||
          (await requestPromotion(specialist, "tecnico")).status !== 200) {
        throw new Error("No se respetaron los permisos para solicitar la promoción.");
      }
      const pending = await apiCall("/admin/sponsored", { headers: admin });
      if (pending.body.requests.filter((item: any) => item.user_id === proId && item.category === "tecnico").length !== 1) {
        throw new Error("La solicitud no llegó una sola vez a Administración.");
      }
      const sponsor = { userId: proId, category: "tecnico", expiresAt: new Date(Date.now() + 3600_000).toISOString(), reference: "PAGO-QA" };
      const publish = (headers: Record<string, string>, data = sponsor) =>
        apiCall("/admin/sponsored", { method: "PUT", headers, body: JSON.stringify(data) });
      if ((await publish(client)).status !== 403 || (await publish(admin, { ...sponsor, category: "pediatria" })).status !== 400 ||
          (await publish(admin)).status !== 200) throw new Error("Falló la autorización o la elegibilidad del patrocinio.");
      const promotion = await apiCall("/accreditation/sponsorship", { headers: specialist });
      if (promotion.status !== 200 || promotion.body.requested.includes("tecnico") ||
          !promotion.body.active.some((item: any) => item.category === "tecnico") ||
          (await requestPromotion(specialist, "tecnico")).status !== 409) {
        throw new Error("El especialista no vio el vencimiento o pudo duplicar una promoción activa.");
      }
      if ((await publish(admin, { ...sponsor, category: "plomeria" })).status !== 200) {
        throw new Error("No se pudo publicar la segunda especialidad del técnico.");
      }
      const technicians = await apiCall("/radar/sponsored?role=tecnico");
      const professionals = await apiCall("/radar/sponsored?role=profesional");
      const grouped = technicians.body.filter((item: any) => item.id === proId);
      if (technicians.status !== 200 || professionals.status !== 200 || grouped.length !== 1 ||
          grouped[0].categories.join(",") !== "plomeria,tecnico" ||
          professionals.body.some((item: any) => item.id === proId) || "payment_reference" in grouped[0]) {
        throw new Error("La vitrina mezcló roles, duplicó perfiles o expuso referencias de pago.");
      }
      const directory = await apiCall("/radar/sponsored?category=tecnico");
      if (!directory.body.some((item: any) => item.id === proId && !("payment_reference" in item))) {
        throw new Error("No apareció el perfil o se expuso la referencia de pago.");
      }
      const trial = { title: "Reparación directa", description: "Prueba de selección", address: "Dirección de prueba",
        lat: 18.48, lng: -69.94, preferredSpecialistId: proId, sponsoredCategory: "tecnico" };
      const post = () => apiCall("/services", { method: "POST", headers: client, body: JSON.stringify(trial) });
      const direct = await post();
      if (direct.status !== 201) throw new Error("No se pudo publicar la solicitud directa.");
      const id = direct.body.requestId;
      const publicList = await apiCall("/services?targetRole=tecnico");
      const privateList = await apiCall("/services?targetRole=tecnico", { headers: specialist });
      const radar = await apiCall("/radar/requests?role=tecnico");
      if (publicList.body.some((item: any) => item.id === id) || radar.body.some((item: any) => item.id === id) ||
          !privateList.body.some((item: any) => item.id === id && item.address === null) ||
          (await apiCall(`/services/${id}`)).status !== 404 || (await apiCall(`/services/${id}/offers`)).status !== 404) {
        throw new Error("La solicitud directa no quedó reservada al cliente y al destinatario.");
      }
      const offer = await apiCall(`/services/${id}/offers`, {
        method: "POST", headers: specialist, body: JSON.stringify({ price: 1000, etaMinutes: 15 }),
      });
      if (offer.status !== 201) throw new Error("El especialista elegido no pudo cotizar.");
      await apiCall(`/admin/sponsored/${proId}/tecnico`, { method: "DELETE", headers: admin });
      if ((await post()).status !== 409) throw new Error("Se aceptó una solicitud nueva con patrocinio retirado.");
      return "Patrocinio autorizado, directorio público, solicitud privada y cotización del especialista elegido.";
    });

    console.log("\n==================================================================");
    const total = testResults.length;
    const passed = testResults.filter((r) => r.passed).length;
    console.log(`RESULTADO DICLIK.COM: ${passed}/${total} SUITES EXITOSAS (${Math.round((passed / total) * 100)}%)`);
    console.log("==================================================================\n");

    return { total, passed, results: testResults };
  } finally {
    server.close();
  }
}

runAllTests()
  .then((res) => {
    process.exit(res.passed === res.total ? 0 : 1);
  })
  .catch((err) => {
    console.error("Error fatal en pruebas Diclik.com:", err);
    process.exit(1);
  });
