import { env } from "cloudflare:workers";
import { httpServerHandler } from "cloudflare:node";
import express, { urlencoded } from "express";
import userRouter from "../routes/userRoutes";
import cors from "cors";
import servicesRouter from "../routes/servicesRoutes";
import cartRouter from "../routes/cartsRoutes";
import orderRouter from "../routes/ordersRoutes";
import paymentRouter from "../routes/paymentsRoutes";
import adminRouter from "../routes/adminRoutes";
import agentRouter from "../routes/agentRoutes"
import crypto from "crypto";
import { verifyToken } from "../middleware/auth";
import { AwsClient } from "aws4fetch";

const app = express();

// Increase limit to handle Base64 image payloads
app.use(express.json({ limit: '10mb' }));
app.use(urlencoded({ extended: true, limit: '10mb' }));

app.use(cors({
	origin: ["http://localhost:4200", "https://urban-fix-front.pages.dev"],
	methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
	allowedHeaders: ["Content-Type", "Authorization"],
}));

// 3. The R2 Upload Endpoint using aws4fetch
app.post("/upload-image", verifyToken, async (req, res) => {
	try {
		const { imageBase64, mimeType, originalName } = req.body;

		if (!imageBase64) {
			return res.status(400).json({ success: false, error: "No image provided" });
		}

		// Convert Base64 back to a buffer
		const buffer = Buffer.from(imageBase64, "base64");

		// Generate a unique file name
		const fileExtension = originalName.split('.').pop();
		const uniqueFileName = `avatars/${crypto.randomBytes(16).toString("hex")}.${fileExtension}`;

		// Initialize the lightweight AWS client with your env strings
		const aws = new AwsClient({
			accessKeyId: process.env.R2_ACCESS_KEY_ID,
			secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
			service: "s3",
			region: "auto",
		});

		// Cloudflare R2 API Endpoint format: 
		// https://<ACCOUNT_ID>.r2.cloudflarestorage.com/<BUCKET_NAME>/<OBJECT_KEY>
		const uploadUrl = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${process.env.R2_BUCKET_NAME}/${uniqueFileName}`;

		// Execute the PUT request via standard fetch
		const uploadResponse = await aws.fetch(uploadUrl, {
			method: 'PUT',
			body: buffer,
			headers: {
				'Content-Type': mimeType,
			}
		});

		if (!uploadResponse.ok) {
			const errText = await uploadResponse.text();
			throw new Error(`R2 Upload failed: ${uploadResponse.status} - ${errText}`);
		}

		// Construct the public URL 
		const imageUrl = `${process.env.R2_PUBLIC_URL}/${uniqueFileName}`;

		return res.status(200).json({
			success: true,
			imageUrl: imageUrl
		});

	} catch (err) {
		console.error("POST /upload-image Error:", err);
		return res.status(500).json({ success: false, error: err.message || "Failed to upload image" });
	}
});

// User Routes
app.use("/users", userRouter);

// Services Routes
app.use("/services", servicesRouter);

// Cart Routes
app.use("/cart", cartRouter);

// Order Routes
app.use("/orders", orderRouter);

// Payment Routes
app.use("/payments", paymentRouter);

// Admin Routes
app.use("/admin", adminRouter);

// Agent Routes
app.use("/agent", agentRouter);

app.get("/", (req, res) => {
	res.json({ message: "Express.js running on Cloudflare Workers!" });
});

// Start the Express app and capture the server instance
const server = app.listen(3000, () => {
	console.log("Server initialized for Cloudflare Workers");
});

// Pass the server instance, NOT the app function
export default httpServerHandler(server);
