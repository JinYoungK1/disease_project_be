const jwt = require("jsonwebtoken");
const logger = require("../logs/logger");
//const AuthorityManage = require("../models/reference/groupauthority/AuthorityManage");

const errorMessage = err => {
  if (typeof err === "string") {
    return err;
  } else if (err && err.message) {
    return err.message;
  } else {
    return "An unknown error occurred";
  }
};

const keyMap = {
  businessinfo: "businessInfo",
  customerinfo: "customerInfo",
  product: "itemInfo",
  recipe: "recipeInfo",
  storage: "warehouseManage",
  employee: "employeeInfo",
  groupauthority: "authorityManage",
  calender: "calendar",
  setting: "comprehensiveSetting",
  process: "processInfo",
  equipment: "equipmentInfo",
  taxinvoice : "issuanceofrevisedtaxinvoice",
  farm : "farmInfo",
  cert : "certInfo",
};

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    logger.error(`${req.method} ${req.url}::Invalid Token`);
    return res.status(401).json({ result: false, message: `${req.method} ${req.url}::Invalid Token` });
  }

  jwt.verify(token, process.env.TOKEN_SECRET_KEY, async (err, user) => {
    if (err) {
      logger.error(`${req.method} ${req.url}::Not Match Token because ` + errorMessage(err));
      return res.status(403).json({ result: false, message: "Not Match Token", error: errorMessage(err) });
    }

    const keys = Object.keys(keyMap);
    const foundKey = keys.find(key => req.url.includes(key));
    const finalKey = foundKey ? keyMap[foundKey] : "";

    // const data = await AuthorityManage.findAll();
    const data = [];
    if (data.length !== 0) {
      const findAuthorityArr = data.find(item => item.group_name === user.group_name);
      const findAuthority = JSON.parse(findAuthorityArr.dataValues.sub_menu).find(item => item.key === finalKey);

      const authorityResult = { isBlock: false, error: "" };
      if (findAuthority) {
        if (req.method === "POST") {
          if (findAuthority.create !== "t") {
            authorityResult.isBlock = true;
            authorityResult.error = "등록 권한이 없습니다.";
          }
        }

        if (req.method === "GET") {
          if (findAuthority.read !== "t") {
            authorityResult.isBlock = true;
            authorityResult.error = "보기 권한이 없습니다.";
          }
        }

        if (req.method === "PUT") {
          if (findAuthority.update !== "t") {
            authorityResult.isBlock = true;
            authorityResult.error = "수정 권한이 없습니다.";
          }
        }

        if (req.method === "DELETE") {
          if (findAuthority.create !== "t") {
            authorityResult.isBlock = true;
            authorityResult.error = "삭제 권한이 없습니다.";
          }
        }
      }
      req.checkAuth = authorityResult;
    }

    req.user = user;
    next();
  });
};

module.exports = authenticateToken;
