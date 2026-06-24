import "../Services/firebase.js";
import { getAuth } from "firebase-admin/auth";

const verifyFirebase = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: "No token provided"
      });
    }

    const token = authHeader.replace("Bearer ", "");

    const decodedToken = await getAuth().verifyIdToken(token);

    req.user = decodedToken;
    next();
  } catch (err) {
    console.error(err);

    return res.status(401).json({
      success: false,
      message: "Unauthorized"
    });
  }
};

export default verifyFirebase;