const { createLogger, format, transports } = require("winston");
const { combine, timestamp, printf } = format;

// 커스텀 로그 포맷 정의
const myFormat = printf(({ level, message, timestamp }) => {
  return `${timestamp} [${level}]: ${message}`;
});

const logger = createLogger({
  level: "info",
  format: combine(timestamp(), myFormat),
  transports: [
    new transports.Console({
      format: format.combine(
        format.colorize(), // 콘솔에서는 색상 적용
        format.simple()
      ),
    }),
  ],
});

if (process.env.NODE_ENV === "production") {
  logger.add(
    new transports.File({
      filename: "error.log",
      level: "error",
      format: format.combine(
        format.uncolorize(), // 파일에는 색상 제거
        myFormat
      ),
    })
  );
  logger.add(
    new transports.File({
      filename: "combined.log",
      format: format.combine(
        format.uncolorize(), // 파일에는 색상 제거
        myFormat
      ),
    })
  );
}

module.exports = logger;
