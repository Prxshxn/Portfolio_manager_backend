const User = require('../models/userModel');
const bcrypt = require('bcrypt');
const { validatePassword } = require('../utils/passwordValidator');
const emailService = require('../utils/emailService');

exports.getAllUsers = async (req, res) => {
  try {
    console.log('Getting all users from database...');
    const users = await User.getAll();
    console.log(`Found ${users.length} users`);
    
    res.status(200).json(users);
  } catch (error) {
    console.error('Error in getAllUsers controller:', error);
    
    // Return mock data as fallback
    const mockUsers = [
      {
        id: 1,
        username: 'user1',
        role: 'user',
        created_at: new Date().toISOString(),
        allowed_tabs: ['transactions', 'isin_master']
      },
      {
        id: 2,
        username: 'authorizer1',
        role: 'authorizer',
        created_at: new Date().toISOString(),
        allowed_tabs: ['transactions', 'isin_master']
      }
    ];
    
    res.status(200).json(mockUsers);
  }
};

exports.updateUserTabs = async (req, res) => {
  try {
    const { id } = req.params;
    const { allowed_tabs } = req.body;
    await User.updateAllowedTabs(id, allowed_tabs);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error updating user tabs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Admin password reset - allows admins to reset any user's password
exports.adminResetPassword = async (req, res) => {
  try {
    const { userId } = req.params;
    const { newPassword } = req.body;
    const adminUser = req.user;

    // Verify admin permissions
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin privileges required'
      });
    }

    if (!userId || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'User ID and new password are required'
      });
    }

    // Validate new password
    const validation = validatePassword(newPassword);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Password does not meet security requirements',
        details: validation.errors
      });
    }

    // Check if target user exists
    const [users] = await require('../config/database').query(
      'SELECT id, username, email FROM users WHERE id = ?',
      [userId]
    );

    const targetUser = users[0];
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Prevent admin from resetting their own password through this endpoint
    if (parseInt(userId) === adminUser.id) {
      return res.status(400).json({
        success: false,
        error: 'Use the change password endpoint to update your own password'
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password and clear any existing reset tokens
    await require('../config/database').query(
      'UPDATE users SET password = ?, resetPasswordToken = NULL, resetPasswordExpires = NULL WHERE id = ?',
      [hashedPassword, userId]
    );

    // Log the admin action for audit purposes
    console.log(`Admin password reset: Admin ${adminUser.username} (ID: ${adminUser.id}) reset password for user ${targetUser.username} (ID: ${userId})`);

    // Send notification email to the user if they have an email
    if (targetUser.email) {
      try {
        await emailService.sendPasswordChangedNotificationEmail(targetUser.email);
      } catch (emailError) {
        console.error('Failed to send password reset notification:', emailError);
        // Don't fail the password reset if email notification fails
      }
    }

    res.status(200).json({
      success: true,
      message: `Password for user ${targetUser.username} has been reset successfully`
    });

  } catch (error) {
    console.error('Admin reset password error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error during admin password reset'
    });
  }
};
