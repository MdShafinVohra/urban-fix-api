import { env } from "cloudflare:workers";
import { httpServerHandler } from "cloudflare:node";
import express, { urlencoded } from "express";
import userRouter from "../routes/userRoutes";
import cors from "cors";

const app = express();

// Middleware to parse JSON bodies
app.use(express.json());

// For Form Responses
app.use(urlencoded({ extended: true }));


app.use(cors({
	origin: "http://localhost:3000",
	methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
	allowedHeaders: ["Content-Type", "Authorization"],
}));
// User Routes
app.use("/users", userRouter);



// Health check endpoint
app.get("/", (req, res) => {
	res.json({ message: "Express.js running on Cloudflare Workers!" });
});


app.listen(3000);
export default httpServerHandler({ port: 3000 });