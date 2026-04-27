import express from "express";
import {
  getManagers,
  getManagersForLogin,
  getManagerById,
  createManager,
  updateManager,
  deleteManager,
  loginManager
} from "../controllers/managersController.js";
import { authenticateManager, authorizeSuperuser } from "../index.js";

const router = express.Router();

router.get("/login-list", getManagersForLogin);
router.get("/", authenticateManager, authorizeSuperuser, getManagers);
router.get("/:id", getManagerById);
router.post("/", createManager);
router.put("/:id", updateManager);
router.delete("/:id", deleteManager);
router.post("/login", loginManager);

export default router; 