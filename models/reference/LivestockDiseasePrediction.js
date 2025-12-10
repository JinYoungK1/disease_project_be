const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

const LivestockDiseasePrediction = sequelize.define(
  "LivestockDiseasePrediction",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    prediction_date: {
      type: DataTypes.STRING(8),
      allowNull: false,
      comment: "예상 발생일자 (YYYYMMDD) - 질병이 발생할 것으로 예측되는 날짜",
    },
    lknts_nm: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: "가축전염병명",
    },
    predicted_livestock_count: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
      comment: "예상 발생 마리수 (사용 안함)",
    },
    confidence_score: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      defaultValue: 0,
      comment: "예측 신뢰도 (0-100)",
    },
    prediction_basis: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "예측 근거 (JSON 형식)",
    },
    region: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: "지역 (시도)",
    },
    lvstckspc_nm: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: "축종(품종)",
    },
    risk_level: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: "위험도 (LOW, MEDIUM, HIGH, CRITICAL)",
    },
  },
  {
    tableName: "livestock_disease_prediction",
    timestamps: true,
    charset: "utf8",
    collate: "utf8_general_ci",
    indexes: [
      {
        fields: ["prediction_date"],
        name: "idx_prediction_date",
      },
      {
        fields: ["lknts_nm"],
        name: "idx_lknts_nm",
      },
      {
        fields: ["prediction_date", "lknts_nm"],
        name: "idx_date_disease",
      },
    ],
  }
);

module.exports = LivestockDiseasePrediction;

