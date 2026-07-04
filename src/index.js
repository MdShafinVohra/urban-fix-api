import { env } from "cloudflare:workers";
import { httpServerHandler } from "cloudflare:node";
import express, { urlencoded } from "express";
import userRouter from "../routes/userRoutes";

const app = express();

// Middleware to parse JSON bodies
app.use(express.json());

// For Form Responses
app.use(urlencoded({ extended: true }));

// User Routes
app.use("/users", userRouter);



// Health check endpoint
app.get("/", (req, res) => {
	res.json({ message: "Express.js running on Cloudflare Workers!" });
});


app.listen(3000);
export default httpServerHandler({ port: 3000 });