const axios = require("axios");

const API_URL = "http://localhost:3050";

async function generatePredictions() {
  try {
    console.log("🚀 질병 발생 예측 생성을 시작합니다...\n");

    const response = await axios.post(
      `${API_URL}/api/dashboard/disease-occurrence/predict`,
      { months: 12 }, // 1년치 예측
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 300000, // 5분 타임아웃
      }
    );

    console.log("✅ 예측 생성 완료!");
    console.log("\n📊 결과:");
    console.log(JSON.stringify(response.data, null, 2));

    // 예측 통계 조회
    console.log("\n📈 예측 통계를 조회합니다...\n");
    const statsResponse = await axios.get(
      `${API_URL}/api/dashboard/disease-occurrence/predict/statistics`
    );

    console.log("📊 예측 통계:");
    console.log(JSON.stringify(statsResponse.data, null, 2));

    // 샘플 예측 데이터 조회
    console.log("\n📋 샘플 예측 데이터 (최근 10개):\n");
    const sampleResponse = await axios.get(
      `${API_URL}/api/dashboard/disease-occurrence/predict?limit=10&page=1`
    );

    const predictions = sampleResponse.data.data.list;
    predictions.forEach((pred, index) => {
      const year = pred.prediction_date.substring(0, 4);
      const month = pred.prediction_date.substring(4, 6);
      console.log(`${index + 1}. ${pred.lknts_nm} (${year}년 ${month}월)`);
      console.log(`   예측 월: ${pred.prediction_date}`);
      console.log(`   신뢰도: ${pred.confidence_score}%`);
      console.log(`   위험도: ${pred.risk_level}`);
      console.log(`   지역: ${pred.region || "전체"}`);
      if (pred.prediction_basis) {
        const basis = typeof pred.prediction_basis === 'string' 
          ? JSON.parse(pred.prediction_basis) 
          : pred.prediction_basis;
        console.log(`   예측 근거: ${basis.predictionReason || basis.reason || "데이터 기반"}`);
      }
      console.log("");
    });

    process.exit(0);
  } catch (error) {
    console.error("❌ 오류 발생:", error.message);
    if (error.response) {
      console.error("응답:", error.response.data);
    }
    if (error.code === "ECONNREFUSED") {
      console.error("서버에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요.");
    }
    process.exit(1);
  }
}

// 서버 연결 확인
axios
  .get(`${API_URL}/api/dashboard/disease-occurrence/predict/statistics`, {
    validateStatus: () => true,
  })
  .then(() => {
    generatePredictions();
  })
  .catch(error => {
    if (error.code === "ECONNREFUSED") {
      console.error("❌ 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요.");
      console.log("💡 서버를 실행하려면: npm run dev");
    } else {
      generatePredictions();
    }
  });

