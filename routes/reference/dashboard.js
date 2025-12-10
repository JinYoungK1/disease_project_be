const express = require("express");
const router = express.Router();
const path = require("path");
const sequelize = require("../../config/database");
const authenticateToken = require("../../authenticate");
const Joi = require("joi");
const { Op, QueryTypes } = require("sequelize");
const axios = require("axios");
const xml2js = require("xml2js");
const cron = require("node-cron");
const LivestockDiseaseOccurrence = require("../../models/reference/LivestockDiseaseOccurrence");
const LivestockDiseasePrediction = require("../../models/reference/LivestockDiseasePrediction");

const logger = require("../../logs/logger");
const dotenv = require("dotenv");
dotenv.config();

// 진행 상황 저장용 객체
const syncStatus = {
  isRunning: false,
  startTime: null,
  endTime: null,
  totalRecords: 0,
  totalPages: 0,
  currentPage: 0,
  totalProcessed: 0,
  totalUpserted: 0,
  totalErrors: 0,
  logs: [],
  error: null,
};

// 로그 추가 함수
function addLog(message, type = "info") {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    type, // 'info', 'success', 'error', 'progress'
    message,
  };
  syncStatus.logs.push(logEntry);
  // 최근 1000개 로그만 유지
  if (syncStatus.logs.length > 1000) {
    syncStatus.logs = syncStatus.logs.slice(-1000);
  }
  logger.info(`[Sync] ${message}`);
}

const deliverymanagementSchema = Joi.object({
  delivery_date: Joi.string().allow(null, ""),
  delivery_customer: Joi.string().allow(null, ""),
  delivery_origin: Joi.string().allow(null, ""),
  delivery_product: Joi.string().allow(null, ""),
  delivery_size: Joi.string().allow(null, ""),
  delivery_unitqty: Joi.string().allow(null, ""),
  delivery_boxqty: Joi.string().allow(null, ""),
  delivery_unit: Joi.string().allow(null, ""),
  delivery_price: Joi.string().allow(null, ""),
  delivery_totalprice: Joi.string().allow(null, ""),
  delivery_plusprice: Joi.string().allow(null, ""),
  delivery_inprice: Joi.string().allow(null, ""),
  delivery_leaveprice: Joi.string().allow(null, ""),
  delivery_inprice_name: Joi.string().allow(null, ""),
  delivery_inprice_detail: Joi.string().allow(null, ""),
});

const ordermanagementSchema = Joi.object({
  start_name: Joi.string().allow(null, ""),
  start_business_number: Joi.string().allow(null, ""),
  arrival_name: Joi.string().allow(null, ""),
  arrival_business_number: Joi.string().allow(null, ""),
  order_date: Joi.any(),
  taxInvoiceTradeLineItems: Joi.any(),
  order_deposit_date: Joi.any(),
  order_stock_date: Joi.any(),
  order_shipment_request_date: Joi.any(),
  order_shipment_date: Joi.any(),
  order_salesbook_date: Joi.any(),
  order_invoice_issue_date: Joi.any(),
  order_sortation: Joi.string().allow(null, ""),
  order_note: Joi.string().allow(null, ""),
  tax_type: Joi.string().allow(null, ""),
  order_accounttransactions: Joi.any(),
  order_complete: Joi.string().allow(null, ""),
});

const errorMessage = err => {
  if (typeof err === "string") {
    return err;
  } else if (err && err.message) {
    return err.message;
  } else {
    return "An unknown error occurred";
  }
};

// 전염병 발생 데이터 조회
router.get("/disease-occurrence", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    // 필터 조건
    const where = {};
    if (req.query.lknts_nm) {
      where.lknts_nm = { [Op.like]: `%${req.query.lknts_nm}%` };
    }
    if (req.query.farm_nm) {
      where.farm_nm = { [Op.like]: `%${req.query.farm_nm}%` };
    }
    if (req.query.occrrnc_de) {
      where.occrrnc_de = req.query.occrrnc_de;
    }
    if (req.query.lvstckspc_nm) {
      where.lvstckspc_nm = { [Op.like]: `%${req.query.lvstckspc_nm}%` };
    }

    // 데이터 조회
    const { count, rows } = await LivestockDiseaseOccurrence.findAndCountAll({
      where,
      limit,
      offset,
      order: [["occrrnc_de", "DESC"], ["id", "DESC"]],
    });

    res.status(200).json({
      result: true,
      message: "전염병 발생 데이터 조회 성공",
      data: {
        list: rows,
        pagination: {
          total: count,
          page,
          limit,
          totalPages: Math.ceil(count / limit),
        },
      },
    });
  } catch (error) {
    logger.error(`Error fetching disease occurrence: ${error.message}`);
    res.status(500).json({
      result: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
});

// 전염병별 발생마리수 합계 통계
router.get("/disease-occurrence/statistics/by-disease", async (req, res) => {
  try {
    const statistics = await sequelize.query(
      `SELECT 
        lknts_nm AS diseaseName,
        COUNT(*) AS occurrenceCount,
        SUM(occrrnc_lvstckcnt) AS totalLivestockCount,
        MIN(occrrnc_de) AS firstOccurrenceDate,
        MAX(occrrnc_de) AS lastOccurrenceDate
      FROM livestock_disease_occurrence
      WHERE lknts_nm IS NOT NULL
      GROUP BY lknts_nm
      ORDER BY totalLivestockCount DESC`,
      {
        type: QueryTypes.SELECT,
      }
    );

    res.status(200).json({
      result: true,
      message: "전염병별 발생마리수 합계 통계 조회 성공",
      data: statistics,
    });
  } catch (error) {
    logger.error(`Error fetching disease statistics: ${error.message}`);
    res.status(500).json({
      result: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
});

// 년별 전염병별 발생마리수 합계 통계
router.get("/disease-occurrence/statistics/by-year", async (req, res) => {
  try {
    const year = req.query.year; // 선택적 년도 필터

    let query = `SELECT 
      SUBSTRING(occrrnc_de, 1, 4) AS year,
      lknts_nm AS diseaseName,
      COUNT(*) AS occurrenceCount,
      SUM(occrrnc_lvstckcnt) AS totalLivestockCount
    FROM livestock_disease_occurrence
    WHERE occrrnc_de IS NOT NULL AND lknts_nm IS NOT NULL`;

    if (year) {
      query += ` AND SUBSTRING(occrrnc_de, 1, 4) = :year`;
    }

    query += ` GROUP BY SUBSTRING(occrrnc_de, 1, 4), lknts_nm
      ORDER BY year DESC, totalLivestockCount DESC`;

    const statistics = await sequelize.query(query, {
      replacements: year ? { year } : {},
      type: QueryTypes.SELECT,
    });

    res.status(200).json({
      result: true,
      message: "년별 전염병별 발생마리수 합계 통계 조회 성공",
      data: statistics,
    });
  } catch (error) {
    logger.error(`Error fetching year statistics: ${error.message}`);
    res.status(500).json({
      result: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
});

// 월별 전염병별 발생마리수 합계 통계
router.get("/disease-occurrence/statistics/by-month", async (req, res) => {
  try {
    const year = req.query.year; // 년도 필터 (필수)
    const month = req.query.month; // 선택적 월 필터

    if (!year) {
      return res.status(400).json({
        result: false,
        message: "년도(year) 파라미터가 필요합니다.",
      });
    }

    let query = `SELECT 
      SUBSTRING(occrrnc_de, 1, 4) AS year,
      SUBSTRING(occrrnc_de, 5, 2) AS month,
      lknts_nm AS diseaseName,
      COUNT(*) AS occurrenceCount,
      SUM(occrrnc_lvstckcnt) AS totalLivestockCount
    FROM livestock_disease_occurrence
    WHERE occrrnc_de IS NOT NULL 
      AND lknts_nm IS NOT NULL
      AND SUBSTRING(occrrnc_de, 1, 4) = :year`;

    if (month) {
      query += ` AND SUBSTRING(occrrnc_de, 5, 2) = :month`;
    }

    query += ` GROUP BY SUBSTRING(occrrnc_de, 1, 4), SUBSTRING(occrrnc_de, 5, 2), lknts_nm
      ORDER BY year DESC, month DESC, totalLivestockCount DESC`;

    const statistics = await sequelize.query(query, {
      replacements: { year, month },
      type: QueryTypes.SELECT,
    });

    res.status(200).json({
      result: true,
      message: "월별 전염병별 발생마리수 합계 통계 조회 성공",
      data: statistics,
    });
  } catch (error) {
    logger.error(`Error fetching month statistics: ${error.message}`);
    res.status(500).json({
      result: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
});

// 일별 전염병별 발생마리수 합계 통계
router.get("/disease-occurrence/statistics/by-day", async (req, res) => {
  try {
    const year = req.query.year; // 년도 필터
    const month = req.query.month; // 월 필터
    const startDate = req.query.startDate; // 시작일 (YYYYMMDD)
    const endDate = req.query.endDate; // 종료일 (YYYYMMDD)

    let query = `SELECT 
      occrrnc_de AS occurrenceDate,
      lknts_nm AS diseaseName,
      COUNT(*) AS occurrenceCount,
      SUM(occrrnc_lvstckcnt) AS totalLivestockCount
    FROM livestock_disease_occurrence
    WHERE occrrnc_de IS NOT NULL AND lknts_nm IS NOT NULL`;

    const replacements = {};

    if (startDate && endDate) {
      query += ` AND occrrnc_de BETWEEN :startDate AND :endDate`;
      replacements.startDate = startDate;
      replacements.endDate = endDate;
    } else if (year && month) {
      query += ` AND SUBSTRING(occrrnc_de, 1, 4) = :year 
        AND SUBSTRING(occrrnc_de, 5, 2) = :month`;
      replacements.year = year;
      replacements.month = month;
    } else if (year) {
      query += ` AND SUBSTRING(occrrnc_de, 1, 4) = :year`;
      replacements.year = year;
    } else {
      return res.status(400).json({
        result: false,
        message: "년도(year) 또는 시작일/종료일(startDate/endDate) 파라미터가 필요합니다.",
      });
    }

    query += ` GROUP BY occrrnc_de, lknts_nm
      ORDER BY occrrnc_de DESC, totalLivestockCount DESC`;

    const statistics = await sequelize.query(query, {
      replacements,
      type: QueryTypes.SELECT,
    });

    res.status(200).json({
      result: true,
      message: "일별 전염병별 발생마리수 합계 통계 조회 성공",
      data: statistics,
    });
  } catch (error) {
    logger.error(`Error fetching day statistics: ${error.message}`);
    res.status(500).json({
      result: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
});




// 진행 상황 조회
router.get("/sync-disease-data/status", async (req, res) => {
  try {
    const progress = syncStatus.totalPages > 0 
      ? Math.round((syncStatus.currentPage / syncStatus.totalPages) * 100) 
      : 0;

    res.status(200).json({
      result: true,
      data: {
        ...syncStatus,
        progress,
        elapsedTime: syncStatus.startTime 
          ? Math.floor((new Date() - syncStatus.startTime) / 1000) 
          : 0,
      },
    });
  } catch (error) {
    res.status(500).json({
      result: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
});

// 전염병 발생 데이터 API 동기화
router.post("/sync-disease-data", async (req, res) => {
  // 이미 실행 중이면 에러 반환
  if (syncStatus.isRunning) {
    return res.status(400).json({
      result: false,
      message: "동기화가 이미 실행 중입니다.",
      data: syncStatus,
    });
  }

  // 즉시 응답하고 백그라운드에서 작업 실행
  res.status(202).json({
    result: true,
    message: "동기화 작업이 시작되었습니다. /api/dashboard/sync-disease-data/status 엔드포인트로 진행 상황을 확인하세요.",
  });

  // 백그라운드에서 작업 실행
  (async () => {
    try {
      // 상태 초기화
      syncStatus.isRunning = true;
      syncStatus.startTime = new Date();
      syncStatus.endTime = null;
      syncStatus.totalRecords = 0;
      syncStatus.totalPages = 0;
      syncStatus.currentPage = 0;
      syncStatus.totalProcessed = 0;
      syncStatus.totalUpserted = 0;
      syncStatus.totalErrors = 0;
      syncStatus.logs = [];
      syncStatus.error = null;

      addLog("동기화 작업을 시작합니다.", "info");

      const API_BASE_URL =
        "http://211.237.50.150:7080/openapi/1992afb7c680a24d106b64a071006109a3352aded069ce0e28a0cebff97b5838/xml/Grid_20151204000000000316_1";
      const PAGE_SIZE = 1000;

      // 첫 페이지로 전체 개수 확인
      const firstPageUrl = `${API_BASE_URL}/1/${PAGE_SIZE}`;
      addLog(`첫 페이지 요청: ${firstPageUrl}`, "info");

      const firstResponse = await axios.get(firstPageUrl, {
        headers: {
          "Content-Type": "application/xml",
        },
        timeout: 30000,
      });

      const parser = new xml2js.Parser();
      const firstPageData = await parser.parseStringPromise(firstResponse.data);
      const totalCnt = parseInt(firstPageData.Grid_20151204000000000316_1.totalCnt[0], 10);
      const totalPages = Math.ceil(totalCnt / PAGE_SIZE);

      syncStatus.totalRecords = totalCnt;
      syncStatus.totalPages = totalPages;

      addLog(`전체 레코드: ${totalCnt}개, 전체 페이지: ${totalPages}페이지`, "info");

      // 첫 페이지 데이터 처리
      syncStatus.currentPage = 1;
      const firstPageRows = firstPageData.Grid_20151204000000000316_1.row || [];
      addLog(`페이지 1 처리 중... (${firstPageRows.length}개 레코드)`, "progress");
      
      const firstPageResult = await processAndUpsertRows(firstPageRows, syncStatus);
      syncStatus.totalProcessed += firstPageRows.length;
      syncStatus.totalUpserted += firstPageResult.upserted;
      syncStatus.totalErrors += firstPageResult.errors;

      addLog(
        `페이지 1 완료: 처리 ${firstPageRows.length}개, 저장 ${firstPageResult.upserted}개, 에러 ${firstPageResult.errors}개`,
        "success"
      );

      // 나머지 페이지 처리
      for (let page = 2; page <= totalPages; page++) {
        const startRow = (page - 1) * PAGE_SIZE + 1;
        const endRow = page * PAGE_SIZE;
        const pageUrl = `${API_BASE_URL}/${startRow}/${endRow}`;

        try {
          syncStatus.currentPage = page;
          addLog(`페이지 ${page}/${totalPages} 요청 중... (${startRow}-${endRow})`, "progress");

          const response = await axios.get(pageUrl, {
            headers: {
              "Content-Type": "application/xml",
            },
            timeout: 30000,
          });

          const pageData = await parser.parseStringPromise(response.data);
          const rows = pageData.Grid_20151204000000000316_1.row || [];

          addLog(`페이지 ${page} 처리 중... (${rows.length}개 레코드)`, "progress");

          const pageResult = await processAndUpsertRows(rows, syncStatus);
          syncStatus.totalProcessed += rows.length;
          syncStatus.totalUpserted += pageResult.upserted;
          syncStatus.totalErrors += pageResult.errors;

          const progress = Math.round((page / totalPages) * 100);
          addLog(
            `페이지 ${page} 완료: 처리 ${rows.length}개, 저장 ${pageResult.upserted}개, 에러 ${pageResult.errors}개 (진행률: ${progress}%)`,
            "success"
          );

          // API 부하 방지를 위한 짧은 딜레이
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          addLog(`페이지 ${page} 처리 중 오류 발생: ${error.message}`, "error");
          syncStatus.totalErrors += 1;
        }
      }

      syncStatus.endTime = new Date();
      syncStatus.isRunning = false;

      const elapsedSeconds = Math.floor((syncStatus.endTime - syncStatus.startTime) / 1000);
      addLog(
        `동기화 완료! 총 처리: ${syncStatus.totalProcessed}개, 저장: ${syncStatus.totalUpserted}개, 에러: ${syncStatus.totalErrors}개 (소요 시간: ${elapsedSeconds}초)`,
        "success"
      );
    } catch (error) {
      syncStatus.endTime = new Date();
      syncStatus.isRunning = false;
      syncStatus.error = error.message;
      addLog(`동기화 중 오류 발생: ${error.message}`, "error");
      logger.error(`Error syncing disease data: ${error.message}`);
    }
  })();
});

// XML row 데이터를 파싱하고 DB에 upsert하는 함수
async function processAndUpsertRows(rows, status = null) {
  let upserted = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const rowData = {
        ictsd_occrrnc_no: row.ICTSD_OCCRRNC_NO?.[0] || null,
        lknts_nm: row.LKNTS_NM?.[0] || null,
        farm_nm: row.FARM_NM?.[0] || null,
        farm_locplc_legaldong_code: row.FARM_LOCPLC_LEGALDONG_CODE?.[0] || null,
        farm_locplc: row.FARM_LOCPLC?.[0] || null,
        occrrnc_de: row.OCCRRNC_DE?.[0] || null,
        lvstckspc_code: row.LVSTCKSPC_CODE?.[0] || null,
        lvstckspc_nm: row.LVSTCKSPC_NM?.[0] || null,
        occrrnc_lvstckcnt: row.OCCRRNC_LVSTCKCNT?.[0] ? parseInt(row.OCCRRNC_LVSTCKCNT[0], 10) : null,
        dgnss_engn_code: row.DGNSS_ENGN_CODE?.[0] || null,
        dgnss_engn_nm: row.DGNSS_ENGN_NM?.[0] || null,
        cessation_de: row.CESSATION_DE?.[0] || null,
      };

      // Sequelize 모델을 사용한 UPSERT (findOne 후 create/update)
      const [instance, created] = await LivestockDiseaseOccurrence.findOrCreate({
        where: { ictsd_occrrnc_no: rowData.ictsd_occrrnc_no },
        defaults: rowData,
      });

      if (!created) {
        // 이미 존재하는 경우 업데이트
        await instance.update(rowData);
      }

      upserted++;
    } catch (error) {
      logger.error(`Error upserting row: ${error.message}`);
      errors++;
    }
  }

  return { upserted, errors };
}

// 질병 발생 예측 생성 함수 (재사용 가능하도록 분리)
async function generatePredictions(months = 3) {
  try {
    logger.info(`질병 발생 예측 시작: ${months}개월 예측`);

    // 기존 예측 데이터 삭제 (재생성)
    await LivestockDiseasePrediction.destroy({ where: {} });

    const predictions = [];
    const today = new Date();
    const endDate = new Date(today);
    endDate.setMonth(endDate.getMonth() + months);

    // 모든 전염병 목록 가져오기
    const diseases = await sequelize.query(
      `SELECT DISTINCT lknts_nm 
       FROM livestock_disease_occurrence 
       WHERE lknts_nm IS NOT NULL`,
      { type: QueryTypes.SELECT }
    );

    for (const disease of diseases) {
      const diseaseName = disease.lknts_nm;
      
      // 전체 과거 데이터 분석 (제한 없이)
      const allHistoricalData = await sequelize.query(
        `SELECT 
          SUBSTRING(occrrnc_de, 1, 4) AS year,
          SUBSTRING(occrrnc_de, 5, 2) AS month,
          occrrnc_de AS full_date,
          COUNT(*) AS occurrence_count,
          AVG(occrrnc_lvstckcnt) AS avg_livestock_count,
          SUM(occrrnc_lvstckcnt) AS total_livestock_count,
          STDDEV(occrrnc_lvstckcnt) AS std_dev
        FROM livestock_disease_occurrence
        WHERE lknts_nm = :diseaseName
          AND occrrnc_de IS NOT NULL
          AND occrrnc_lvstckcnt IS NOT NULL
        GROUP BY SUBSTRING(occrrnc_de, 1, 4), SUBSTRING(occrrnc_de, 5, 2), occrrnc_de
        ORDER BY year ASC, month ASC`,
        {
          replacements: { diseaseName },
          type: QueryTypes.SELECT,
        }
      );

      if (allHistoricalData.length === 0) continue;

      // 전체 통계 분석
      const overallStats = await sequelize.query(
        `SELECT 
          COUNT(*) AS total_occurrences,
          AVG(occrrnc_lvstckcnt) AS overall_avg,
          STDDEV(occrrnc_lvstckcnt) AS overall_stddev,
          MIN(occrrnc_lvstckcnt) AS min_count,
          MAX(occrrnc_lvstckcnt) AS max_count,
          MIN(occrrnc_de) AS first_occurrence,
          MAX(occrrnc_de) AS last_occurrence
        FROM livestock_disease_occurrence
        WHERE lknts_nm = :diseaseName
          AND occrrnc_lvstckcnt IS NOT NULL`,
        {
          replacements: { diseaseName },
          type: QueryTypes.SELECT,
        }
      );

      const stats = overallStats[0];

      // 월별 상세 통계 (전체 데이터 기반)
      const monthlyStats = {};
      const monthlyData = await sequelize.query(
        `SELECT 
          SUBSTRING(occrrnc_de, 5, 2) AS month,
          COUNT(*) AS occurrence_count,
          AVG(occrrnc_lvstckcnt) AS avg_count,
          SUM(occrrnc_lvstckcnt) AS total_count,
          STDDEV(occrrnc_lvstckcnt) AS stddev_count,
          MIN(occrrnc_lvstckcnt) AS min_count,
          MAX(occrrnc_lvstckcnt) AS max_count
        FROM livestock_disease_occurrence
        WHERE lknts_nm = :diseaseName
          AND occrrnc_de IS NOT NULL
          AND occrrnc_lvstckcnt IS NOT NULL
        GROUP BY SUBSTRING(occrrnc_de, 5, 2)
        ORDER BY month ASC`,
        {
          replacements: { diseaseName },
          type: QueryTypes.SELECT,
        }
      );

      monthlyData.forEach(row => {
        const month = parseInt(row.month);
        monthlyStats[month] = {
          occurrence_count: parseInt(row.occurrence_count || 0),
          avg_count: parseFloat(row.avg_count || 0),
          total_count: parseFloat(row.total_count || 0),
          stddev_count: parseFloat(row.stddev_count || 0),
          min_count: parseInt(row.min_count || 0),
          max_count: parseInt(row.max_count || 0),
        };
      });

      // 발생 날짜 패턴 분석 (월별 발생 빈도)
      const monthlyOccurrencePattern = {};
      monthlyData.forEach(row => {
        const month = parseInt(row.month);
        monthlyOccurrencePattern[month] = {
          occurrence_count: parseInt(row.occurrence_count || 0),
          avg_days_between: 0, // 월별 평균 발생 간격
        };
      });

      // 전체 발생 빈도 계산
      const totalOccurrences = parseInt(stats.total_occurrences || 0);
      const avgOccurrencesPerMonth = totalOccurrences / 12; // 월평균 발생 횟수

      // 예측 생성 (다음 N개월 중 발생 가능한 날짜 예측)
      const currentDate = new Date(today);
      currentDate.setDate(1); // 월 초일로 설정

      while (currentDate <= endDate) {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;

        // 해당 월의 발생 패턴 분석
        const monthData = monthlyStats[month];
        let confidence = 0;
        let basis = {};

        if (monthData && monthData.occurrence_count > 0) {
          // 해당 월에 과거 발생 빈도가 높은 경우
          const monthlyFrequency = monthData.occurrence_count;
          const monthlyRatio = monthlyFrequency / avgOccurrencesPerMonth; // 월별 발생 비율

          // 발생 가능성 계산 (발생 빈도가 평균보다 높으면 발생 가능성 높음)
          const occurrenceProbability = Math.min(100, Math.round(monthlyRatio * 50));

          // 신뢰도 계산
          let confidenceFactors = 0;
          let maxFactors = 0;

          // 월별 발생 빈도 (최대 40점)
          maxFactors += 40;
          const frequencyScore = Math.min(40, (monthlyFrequency / 10) * 40);
          confidenceFactors += frequencyScore;

          // 전체 데이터 양 (최대 30점)
          maxFactors += 30;
          const totalDataScore = Math.min(30, (totalOccurrences / 200) * 30);
          confidenceFactors += totalDataScore;

          // 데이터 일관성 (최대 30점)
          maxFactors += 30;
          if (monthData.stddev_count > 0 && monthData.avg_count > 0) {
            const cv = monthData.stddev_count / monthData.avg_count;
            const consistencyScore = Math.max(0, 30 - (cv * 15));
            confidenceFactors += consistencyScore;
          } else {
            confidenceFactors += 15; // 기본 점수
          }

          confidence = Math.round((confidenceFactors / maxFactors) * 100);

          // 위험도 계산 (발생 빈도 기반)
          let riskLevel = "LOW";
          if (monthlyFrequency >= 20) riskLevel = "CRITICAL";
          else if (monthlyFrequency >= 10) riskLevel = "HIGH";
          else if (monthlyFrequency >= 5) riskLevel = "MEDIUM";

          basis = {
            method: "date_pattern_analysis",
            monthlyOccurrenceFrequency: monthlyFrequency,
            monthlyRatio: monthlyRatio.toFixed(2),
            occurrenceProbability: occurrenceProbability,
            totalHistoricalOccurrences: totalOccurrences,
            avgOccurrencesPerMonth: avgOccurrencesPerMonth.toFixed(2),
            dataPoints: allHistoricalData.length,
          };

          // 해당 월에 발생 가능한 날짜들을 예측
          // 과거 데이터에서 해당 월의 발생 날짜 패턴 분석
          const historicalDates = await sequelize.query(
            `SELECT 
              SUBSTRING(occrrnc_de, 7, 2) AS day,
              COUNT(*) AS occurrence_count
            FROM livestock_disease_occurrence
            WHERE lknts_nm = :diseaseName
              AND SUBSTRING(occrrnc_de, 5, 2) = :month
              AND occrrnc_de IS NOT NULL
            GROUP BY SUBSTRING(occrrnc_de, 7, 2)
            ORDER BY occurrence_count DESC
            LIMIT 5`,
            {
              replacements: { 
                diseaseName,
                month: String(month).padStart(2, "0")
              },
              type: QueryTypes.SELECT,
            }
          );

          // 발생 가능한 날짜들 생성
          if (historicalDates.length > 0) {
            // 과거 발생 빈도가 높은 날짜들을 예측 날짜로 사용
            for (const datePattern of historicalDates) {
              const day = parseInt(datePattern.day);
              const predictionDateStr = `${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
              
              // 유효한 날짜인지 확인
              const checkDate = new Date(year, month - 1, day);
              if (checkDate.getMonth() === month - 1 && checkDate.getDate() === day) {
                const dateBasis = {
                  ...basis,
                  historicalDayOccurrences: parseInt(datePattern.occurrence_count),
                  predictionReason: `과거 ${month}월 ${day}일에 ${datePattern.occurrence_count}회 발생`,
                };

                predictions.push({
                  prediction_date: predictionDateStr,
                  lknts_nm: diseaseName,
                  predicted_livestock_count: null,
                  confidence_score: confidence,
                  prediction_basis: JSON.stringify(dateBasis),
                  region: null,
                  risk_level: riskLevel,
                });
              }
            }
          } else {
            // 과거 날짜 패턴이 없는 경우, 월 중순(15일)을 예측 날짜로 사용
            const predictionDateStr = `${year}${String(month).padStart(2, "0")}15`;
            const dateBasis = {
              ...basis,
              predictionReason: "과거 데이터 패턴 기반 월 중순 예측",
            };

            predictions.push({
              prediction_date: predictionDateStr,
              lknts_nm: diseaseName,
              predicted_livestock_count: null,
              confidence_score: Math.max(30, confidence - 20), // 신뢰도 조정
              prediction_basis: JSON.stringify(dateBasis),
              region: null,
              risk_level: riskLevel,
            });
          }
        } else {
          // 해당 월에 과거 발생 데이터가 없는 경우, 낮은 신뢰도로 예측
          const predictionDateStr = `${year}${String(month).padStart(2, "0")}15`;
          confidence = Math.min(30, Math.round((totalOccurrences / 500) * 30));
          
          basis = {
            method: "low_confidence_prediction",
            totalOccurrences: totalOccurrences,
            reason: "해당 월에 과거 발생 데이터가 없음",
          };

          predictions.push({
            prediction_date: predictionDateStr,
            lknts_nm: diseaseName,
            predicted_livestock_count: null,
            confidence_score: confidence,
            prediction_basis: JSON.stringify(basis),
            region: null,
            risk_level: "LOW",
          });
        }

        // 다음 달로 이동
        currentDate.setMonth(currentDate.getMonth() + 1);
      }
    }

    // 예측 데이터 일괄 저장
    if (predictions.length > 0) {
      await LivestockDiseasePrediction.bulkCreate(predictions, {
        ignoreDuplicates: true,
      });
    }

    logger.info(`질병 발생 예측 완료: ${predictions.length}개 예측 데이터 생성`);

    return {
      result: true,
      message: `질병 발생 예측이 완료되었습니다. ${predictions.length}개의 예측 데이터가 생성되었습니다.`,
      data: {
        totalPredictions: predictions.length,
        months,
        generatedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    logger.error(`Error generating predictions: ${error.message}`);
    throw error;
  }
}

// 질병 발생 예측 생성 API
router.post("/disease-occurrence/predict", async (req, res) => {
  try {
    const { months = 3 } = req.body; // 예측할 개월 수 (기본 3개월)
    const result = await generatePredictions(months);
    res.status(200).json(result);
  } catch (error) {
    logger.error(`Error generating predictions: ${error.message}`);
    res.status(500).json({
      result: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
});

// 예측 데이터 조회
router.get("/disease-occurrence/predict", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const where = {};
    
    // 전염병명 필터
    if (req.query.lknts_nm) {
      where.lknts_nm = { [Op.like]: `%${req.query.lknts_nm}%` };
    }
    
    // 날짜 필터
    if (req.query.prediction_date) {
      where.prediction_date = { [Op.like]: `${req.query.prediction_date}%` };
    }
    
    // 날짜 범위 필터
    if (req.query.startDate && req.query.endDate) {
      where.prediction_date = {
        [Op.between]: [req.query.startDate, req.query.endDate],
      };
    } else if (req.query.startDate) {
      where.prediction_date = { [Op.gte]: req.query.startDate };
    } else if (req.query.endDate) {
      where.prediction_date = { [Op.lte]: req.query.endDate };
    }
    
    // 오늘 이후 예측만 조회
    if (req.query.upcoming === "true") {
      const today = new Date();
      const todayStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
      where.prediction_date = { [Op.gte]: todayStr };
    }
    
    // 지역 필터
    if (req.query.region) {
      where.region = { [Op.like]: `%${req.query.region}%` };
    }
    
    // 위험도 필터
    if (req.query.risk_level) {
      where.risk_level = req.query.risk_level;
    }
    
    // 신뢰도 필터 (최소 신뢰도)
    if (req.query.min_confidence) {
      where.confidence_score = { [Op.gte]: parseFloat(req.query.min_confidence) };
    }

    const { count, rows } = await LivestockDiseasePrediction.findAndCountAll({
      where,
      limit,
      offset,
      order: [["prediction_date", "ASC"], ["risk_level", "DESC"], ["confidence_score", "DESC"]],
    });

    // JSON 파싱
    const predictions = rows.map(row => {
      const data = row.toJSON();
      if (data.prediction_basis) {
        try {
          data.prediction_basis = JSON.parse(data.prediction_basis);
        } catch (e) {
          data.prediction_basis = {};
        }
      }
      return data;
    });

    res.status(200).json({
      result: true,
      message: "예측 데이터 조회 성공",
      data: {
        list: predictions,
        pagination: {
          total: count,
          page,
          limit,
          totalPages: Math.ceil(count / limit),
        },
      },
    });
  } catch (error) {
    logger.error(`Error fetching predictions: ${error.message}`);
    res.status(500).json({
      result: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
});

// 전염병별 예측 목록 조회
router.get("/disease-occurrence/predict/by-disease", async (req, res) => {
  try {
    const diseaseName = req.query.lknts_nm;
    
    if (!diseaseName) {
      return res.status(400).json({
        result: false,
        message: "전염병명(lknts_nm) 파라미터가 필요합니다.",
      });
    }

    const predictions = await LivestockDiseasePrediction.findAll({
      where: {
        lknts_nm: { [Op.like]: `%${diseaseName}%` },
      },
      order: [["prediction_date", "ASC"]],
    });

    // JSON 파싱
    const result = predictions.map(row => {
      const data = row.toJSON();
      if (data.prediction_basis) {
        try {
          data.prediction_basis = JSON.parse(data.prediction_basis);
        } catch (e) {
          data.prediction_basis = {};
        }
      }
      return data;
    });

    res.status(200).json({
      result: true,
      message: "전염병별 예측 데이터 조회 성공",
      data: {
        diseaseName,
        predictions: result,
        totalCount: result.length,
      },
    });
  } catch (error) {
    logger.error(`Error fetching predictions by disease: ${error.message}`);
    res.status(500).json({
      result: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
});

// 날짜별 예측 목록 조회
router.get("/disease-occurrence/predict/by-date", async (req, res) => {
  try {
    const date = req.query.date; // YYYYMMDD 형식
    
    if (!date) {
      return res.status(400).json({
        result: false,
        message: "날짜(date) 파라미터가 필요합니다. (YYYYMMDD 형식)",
      });
    }

    const predictions = await LivestockDiseasePrediction.findAll({
      where: {
        prediction_date: date,
      },
      order: [["risk_level", "DESC"], ["confidence_score", "DESC"]],
    });

    // JSON 파싱
    const result = predictions.map(row => {
      const data = row.toJSON();
      if (data.prediction_basis) {
        try {
          data.prediction_basis = JSON.parse(data.prediction_basis);
        } catch (e) {
          data.prediction_basis = {};
        }
      }
      return data;
    });

    res.status(200).json({
      result: true,
      message: "날짜별 예측 데이터 조회 성공",
      data: {
        date,
        predictions: result,
        totalCount: result.length,
      },
    });
  } catch (error) {
    logger.error(`Error fetching predictions by date: ${error.message}`);
    res.status(500).json({
      result: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
});

// 위험도별 예측 목록 조회
router.get("/disease-occurrence/predict/by-risk", async (req, res) => {
  try {
    const riskLevel = req.query.risk_level; // LOW, MEDIUM, HIGH, CRITICAL
    
    if (!riskLevel) {
      return res.status(400).json({
        result: false,
        message: "위험도(risk_level) 파라미터가 필요합니다. (LOW, MEDIUM, HIGH, CRITICAL)",
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const { count, rows } = await LivestockDiseasePrediction.findAndCountAll({
      where: {
        risk_level: riskLevel,
      },
      limit,
      offset,
      order: [["prediction_date", "ASC"], ["confidence_score", "DESC"]],
    });

    // JSON 파싱
    const predictions = rows.map(row => {
      const data = row.toJSON();
      if (data.prediction_basis) {
        try {
          data.prediction_basis = JSON.parse(data.prediction_basis);
        } catch (e) {
          data.prediction_basis = {};
        }
      }
      return data;
    });

    res.status(200).json({
      result: true,
      message: "위험도별 예측 데이터 조회 성공",
      data: {
        riskLevel,
        list: predictions,
        pagination: {
          total: count,
          page,
          limit,
          totalPages: Math.ceil(count / limit),
        },
      },
    });
  } catch (error) {
    logger.error(`Error fetching predictions by risk: ${error.message}`);
    res.status(500).json({
      result: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
});

// 다가오는 예측 조회 (오늘 이후)
router.get("/disease-occurrence/predict/upcoming", async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30; // 기본 30일
    const today = new Date();
    const futureDate = new Date(today);
    futureDate.setDate(futureDate.getDate() + days);
    
    const todayStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
    const futureDateStr = `${futureDate.getFullYear()}${String(futureDate.getMonth() + 1).padStart(2, "0")}${String(futureDate.getDate()).padStart(2, "0")}`;

    const predictions = await LivestockDiseasePrediction.findAll({
      where: {
        prediction_date: {
          [Op.between]: [todayStr, futureDateStr],
        },
      },
      order: [["prediction_date", "ASC"], ["risk_level", "DESC"]],
    });

    // JSON 파싱
    const result = predictions.map(row => {
      const data = row.toJSON();
      if (data.prediction_basis) {
        try {
          data.prediction_basis = JSON.parse(data.prediction_basis);
        } catch (e) {
          data.prediction_basis = {};
        }
      }
      return data;
    });

    res.status(200).json({
      result: true,
      message: `다가오는 ${days}일간의 예측 데이터 조회 성공`,
      data: {
        days,
        fromDate: todayStr,
        toDate: futureDateStr,
        predictions: result,
        totalCount: result.length,
      },
    });
  } catch (error) {
    logger.error(`Error fetching upcoming predictions: ${error.message}`);
    res.status(500).json({
      result: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
});

// 예측 통계 조회
router.get("/disease-occurrence/predict/statistics", async (req, res) => {
  try {
    const statistics = await sequelize.query(
      `SELECT 
        lknts_nm AS diseaseName,
        risk_level AS riskLevel,
        COUNT(*) AS predictionCount,
        AVG(confidence_score) AS avgConfidence,
        MIN(prediction_date) AS earliestPrediction,
        MAX(prediction_date) AS latestPrediction
      FROM livestock_disease_prediction
      GROUP BY lknts_nm, risk_level
      ORDER BY predictionCount DESC, avgConfidence DESC`,
      {
        type: QueryTypes.SELECT,
      }
    );

    res.status(200).json({
      result: true,
      message: "예측 통계 조회 성공",
      data: statistics,
    });
  } catch (error) {
    logger.error(`Error fetching prediction statistics: ${error.message}`);
    res.status(500).json({
      result: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
});

// 매일 새벽 1시에 자동으로 예측 생성
// cron 표현식: "0 1 * * *" = 매일 01:00에 실행
cron.schedule("0 1 * * *", async () => {
  try {
    logger.info("⏰ 스케줄러: 자동 예측 생성 시작 (새벽 1시)");
    const result = await generatePredictions(3); // 3개월 예측
    logger.info(`✅ 스케줄러: 자동 예측 생성 완료 - ${result.data.totalPredictions}개 예측 데이터 생성`);
  } catch (error) {
    logger.error(`❌ 스케줄러: 자동 예측 생성 실패 - ${error.message}`);
  }
}, {
  scheduled: true,
  timezone: "Asia/Seoul", // 한국 시간대
});

logger.info("📅 예측 자동 스케줄러가 등록되었습니다. (매일 새벽 1시 실행)");

module.exports = router;
