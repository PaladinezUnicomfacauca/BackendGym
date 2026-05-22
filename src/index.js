import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cron from "node-cron";
import jwt from "jsonwebtoken";
import managersRoutes from "./routes/managersRoutes.js"; 
import usersRoutes from "./routes/usersRoutes.js";
import membershipsRoutes from "./routes/membershipsRoutes.js";
import plansRoutes from "./routes/plansRoutes.js";
import paymentMethodsRoutes from "./routes/paymentMethodsRoutes.js";
import statesRoutes from "./routes/statesRoutes.js";
import rolesRoutes from "./routes/rolesRoutes.js";
import identificationTypesRoutes from "./routes/identificationTypesRoutes.js";
import healthCheckRoutes from "./routes/healthCheck.js"; 

dotenv.config();

const app = express();

// Middleware de autenticación JWT
export function authenticateManager(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.manager = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Middleware de autorización por rol: solo Superusuario.
export function authorizeSuperuser(req, res, next) {
  const roleName = String(req.manager?.name_role || "").trim().toLowerCase();
  const roleId = Number(req.manager?.id_role);

  if (roleName === "superusuario" || roleId === 1) {
    return next();
  }

  return res.status(403).json({ error: "Access denied: superuser role required" });
}

// Middleware
app.use(cors());
app.use(express.json());

// Crear un router para la API
const apiRouter = express.Router();

// Definir las rutas en el router de la API
apiRouter.use("/managers", managersRoutes);
apiRouter.use("/users", usersRoutes);
apiRouter.use("/memberships", membershipsRoutes);
apiRouter.use("/plans", plansRoutes);
apiRouter.use("/payment-methods", paymentMethodsRoutes);
apiRouter.use("/states", statesRoutes);
apiRouter.use("/roles", rolesRoutes);
apiRouter.use("/identification-types", identificationTypesRoutes);
apiRouter.use("/health-check", healthCheckRoutes);

// Usar el router de la API con el prefijo /api
app.use("/api", apiRouter);

// Configurar cron job para actualizar estados diariamente a las 0:00 AM (medianoche)
cron.schedule('0 0 * * *', async () => {
  console.log(`[${new Date().toISOString()}] Ejecutando actualización automática de estados de membresías...`);
  try {
    // Importar dinámicamente para evitar problemas de dependencias circulares
    const { updateAllMembershipStates } = await import('../scripts/updateStates.js');
    await updateAllMembershipStates();
    console.log(`[${new Date().toISOString()}] Actualización automática completada exitosamente`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error en actualización automática:`, error.message);
  }
}, {
  scheduled: true,
  timezone: "America/Bogota" // Ajustar a tu zona horaria
});


// Middleware para rutas no encontradas
app.use((req, res, next) => {
  res.status(404).json({ message: "Ruta no encontrada" });
});

// Middleware de manejo de errores
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: "Algo salió mal!" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT} [${process.env.NODE_ENV || "dev"}] - ${new Date().toLocaleString()}`);
});
