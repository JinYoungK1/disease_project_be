const express = require("express");
const router = express.Router();

const dashboardRouter = require("./dashboard");

router.use("/", dashboardRouter);

module.exports = router;