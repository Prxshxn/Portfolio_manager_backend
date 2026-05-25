const express = require('express');
const { getAllUsers, updateUserTabs, adminResetPassword } = require('../controllers/userController');
const { checkAuth, checkAdmin } = require('../middleware/auth');
const router = express.Router();

/**
 * @swagger
 * /users:
 *   get:
 *     summary: Get all users
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of users
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       401:
 *         description: Unauthorized
 */
router.get('/', getAllUsers);

/**
 * @swagger
 * /users/{id}/tabs:
 *   put:
 *     summary: Update user tabs
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: User ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tabs:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["dashboard", "transactions"]
 *     responses:
 *       200:
 *         description: User tabs updated
 *       404:
 *         description: User not found
 */
router.put('/:id/tabs', updateUserTabs);

/**
 * @swagger
 * /users/{id}/admin-reset-password:
 *   post:
 *     summary: Admin reset user password
 *     description: Allows admin users to reset any user's password. Requires admin privileges.
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: User ID whose password will be reset
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - newPassword
 *             properties:
 *               newPassword:
 *                 type: string
 *                 description: New password meeting security requirements
 *                 example: AdminSetPass123!
 *     responses:
 *       200:
 *         description: Password reset successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       400:
 *         description: Invalid request or weak password
 *       403:
 *         description: Admin privileges required
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
router.post('/:userId/admin-reset-password', checkAuth, checkAdmin, adminResetPassword);

module.exports = router;
