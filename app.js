const express = require("express");
const { connectDB } = require("./config/database");
const config = require("./config/config");
const globalErrorHandler = require("./middlewares/globalErrorHandler");
const cookieParser = require("cookie-parser");
const cors = require("cors");

const app = express();
const PORT = config.port;

app.use(
  cors({
    credentials: true,
    origin: [
      "http://localhost:5173",
      "http://demo.kopiniskala.com",
      "https://demo.kopiniskala.com",
    ],
  })
);
app.use(express.json());
app.use(cookieParser());

app.get("/", (req, res) => {
  res.json({ message: "Hello from POS Server!" });
});

app.use("/api/user", require("./routes/userRoute"));
app.use("/api/order", require("./routes/orderRoute"));
app.use("/api/payment", require("./routes/paymentRoute"));
app.use("/api/category", require("./routes/categoryRoute"));
app.use("/api/menu-item", require("./routes/menuItemRoute"));
app.use("/api/add-on", require("./routes/addOnRoute"));
app.use("/api/stock-item", require("./routes/stockItemRoute"));

app.use(globalErrorHandler);

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`POS Server is listening on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error(`Database connection failed: ${error.message}`);
    process.exit(1);
  });
