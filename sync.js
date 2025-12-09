const sequelize = require("./config/database");
const logger = require("./logs/logger");

// 모델 import
const LivestockDiseaseOccurrence = require("./models/reference/LivestockDiseaseOccurrence");

const syncDatabase = async () => {
  try {
    await sequelize.authenticate();
    logger.info("Connection has been established successfully");

    // 모델 동기화 (테이블 자동 생성)
    await sequelize.sync({ alter: false });
    logger.info("All models were synchronized successfully");
  } catch (error) {
    console.log(error);
    logger.error("Unable to connect to the database: " + error);
  }
};

module.exports = syncDatabase;
