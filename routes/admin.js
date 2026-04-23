const express = require('express');
const router = express.Router();

// Mount all admin sub-modules
router.use(require('./admin-users'));
router.use(require('./admin-coaches'));
router.use(require('./admin-players'));
router.use(require('./admin-settings'));
router.use(require('./admin-operations'));

module.exports = router;
