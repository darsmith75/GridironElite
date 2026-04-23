const express = require('express');

const router = express.Router();

router.use(require('./player-profile'));
router.use(require('./player-invites'));
router.use(require('./player-colleges'));
router.use(require('./player-public'));

module.exports = router;
