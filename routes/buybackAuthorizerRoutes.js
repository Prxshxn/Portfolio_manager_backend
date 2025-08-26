const express = require('express');
const router = express.Router();
const buybackAuthorizerController = require('../controllers/buybackAuthorizerController');

// Create new buyback authorizer assignment
router.post('/', buybackAuthorizerController.createAuthorizer);

// Get all buyback authorizer assignments
router.get('/', buybackAuthorizerController.getAllAuthorizers);

// Get authorizer by user ID
router.get('/user/:userId', buybackAuthorizerController.getAuthorizerByUser);

// Check if user has specific role
router.get('/user/:userId/role/:role', buybackAuthorizerController.checkUserRole);

// Check user limits for deal amount
router.post('/user/:userId/check-limits', buybackAuthorizerController.checkLimits);

// Update authorizer assignment
router.put('/:id', buybackAuthorizerController.updateAuthorizer);

// Delete authorizer assignment
router.delete('/:id', buybackAuthorizerController.deleteAuthorizer);

module.exports = router;
