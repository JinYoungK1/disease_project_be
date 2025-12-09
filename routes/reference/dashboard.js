const express = require("express");
const router = express.Router();
const path = require("path");
const sequelize = require("../../config/database");
const authenticateToken = require("../../authenticate");
const Joi = require("joi");
const { Op, QueryTypes } = require("sequelize");
const axios = require("axios");
const xml2js = require("xml2js");
const LivestockDiseaseOccurrence = require("../../models/reference/LivestockDiseaseOccurrence");

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

module.exports = router;
