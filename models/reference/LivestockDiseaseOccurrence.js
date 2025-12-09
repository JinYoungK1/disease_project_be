const { DataTypes } = require("sequelize");
const sequelize = require("../../config/database");

const LivestockDiseaseOccurrence = sequelize.define(
  "LivestockDiseaseOccurrence",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    ictsd_occrrnc_no: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
      comment: "전염병발생번호",
    },
    lknts_nm: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: "가축전염병명",
    },
    farm_nm: {
      type: DataTypes.STRING(200),
      allowNull: true,
      comment: "농장명(농장주)",
    },
    farm_locplc_legaldong_code: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: "농장소재지 법정동코드",
    },
    farm_locplc: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: "농장소재지",
    },
    occrrnc_de: {
      type: DataTypes.STRING(8),
      allowNull: true,
      comment: "발생일자(진단일)",
    },
    lvstckspc_code: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: "축품종 코드",
    },
    lvstckspc_nm: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: "축종(품종)",
    },
    occrrnc_lvstckcnt: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "발생두수(마리)",
    },
    dgnss_engn_code: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: "진단기관코드",
    },
    dgnss_engn_nm: {
      type: DataTypes.STRING(200),
      allowNull: true,
      comment: "진단기관",
    },
    cessation_de: {
      type: DataTypes.STRING(8),
      allowNull: true,
      comment: "종식일",
    },
  },
  {
    tableName: "livestock_disease_occurrence",
    timestamps: true,
    charset: "utf8",
    collate: "utf8_general_ci",
    indexes: [
      {
        fields: ["occrrnc_de"],
        name: "idx_occrrnc_de",
      },
      {
        fields: ["lknts_nm"],
        name: "idx_lknts_nm",
      },
      {
        fields: ["farm_nm"],
        name: "idx_farm_nm",
      },
    ],
  }
);

module.exports = LivestockDiseaseOccurrence;

