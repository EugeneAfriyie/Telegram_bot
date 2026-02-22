// Eugene Afriyie UEB3502023

require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const mongoose = require("mongoose");
const cron = require("node-cron");

// -------------------
// MongoDB Setup
// -------------------
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("MongoDB Connected ✅"))
    .catch(err => console.log("MongoDB Error:", err));

const User = mongoose.model("User", {
    telegramId: String,
    isVIP: Boolean,
    expiryDate: Date
});

// -------------------
// Bot & Webhook Configuration
// -------------------
const TOKEN = process.env.TOKEN;
const BASE_URL = process.env.BASE_URL; // e.g., https://telegram-bot-ilpz.onrender.com

// 1. Initialize Bot WITHOUT polling
const bot = new TelegramBot(TOKEN);

// 2. Tell Telegram where to push messages
bot.setWebHook(`${BASE_URL}/bot${TOKEN}`);

// -------------------
// Bot Logic (Commands & Interactions)
// -------------------
// Start command with inline buttons
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "Welcome Eugene 🚀 Choose an option:", {
        reply_markup: {
            inline_keyboard: [
                [{ text: "BTC Price 💰", callback_data: "btc" }],
                [{ text: "VIP Subscription 🔥", callback_data: "vip" }]
            ]
        }
    });
});


// Handle button clicks
bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;

    // 🟢 FIX 2: Answer instantly to stop the Telegram "query is too old" error
    bot.answerCallbackQuery(query.id).catch(err => console.log("Callback Answer Error:", err.message));

    if (query.data === "btc") {
        const user = await User.findOne({ telegramId: query.from.id });
        const now = new Date();

        // Check if user exists, is VIP, and hasn't expired
        if (!user || !user.isVIP || (user.expiryDate && user.expiryDate < now)) {
            // Instantly demote them in DB if they are expired
            if (user && user.isVIP) {
                await User.updateOne({ telegramId: query.from.id }, { isVIP: false });
            }
            return bot.sendMessage(chatId, "You must subscribe to VIP to use this feature, or your VIP has expired. 🚫");
        }

       try {
            // 🟢 FIX: Swapped to CoinCap API which is much friendlier to Render servers
            const response = await axios.get("https://api.coincap.io/v2/assets/bitcoin");
            const btcPrice = parseFloat(response.data.data.priceUsd);
            
            bot.sendMessage(chatId, `BTC Price: $${btcPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
        } catch (err) {
            console.log("Price fetch error:", err.message);
            bot.sendMessage(chatId, "Could not fetch BTC price right now. 😔");
        }

    if (query.data === "vip") {
        const reference = `VIP_${query.from.id}_${Date.now()}`;
        const email = query.from.username ? `${query.from.username}@example.com` : "user@example.com";

        try {
            const payResponse = await axios.post(
                "https://api.paystack.co/transaction/initialize",
                {
                    email,
                    amount: 2000 * 100, // Adjust depending on currency
                    callback_url: `${process.env.BASE_URL}/paystack/callback`,
                    reference
                },
                {
                    headers: {
                        Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
                        "Content-Type": "application/json"
                    }
                }
            );

            const payLink = payResponse.data.data.authorization_url;
            bot.sendMessage(chatId, `Click here to pay VIP: ${payLink}`);
        } catch (err) {
            console.log("Paystack Error:", err.response?.data || err.message);
            bot.sendMessage(chatId, "Failed to create payment link. Try again later.");
        }
    }
});

// -------------------
// Express Webhook Server
// -------------------
const app = express();
app.use(bodyParser.json());

// Telegram Webhook Route
app.post(`/bot${TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// Paystack Webhook Route
app.post("/paystack/callback", async (req, res) => {
    const event = req.body;

    if (event.event === "charge.success") {
        const ref = event.data.reference;
        const telegramId = ref.split("_")[1]; // extract from reference

        const expiry = new Date();
        expiry.setDate(expiry.getDate() + 30); // 30-day VIP

        await User.findOneAndUpdate(
            { telegramId },
            { isVIP: true, expiryDate: expiry },
            { upsert: true }
        );

        console.log(`VIP activated for Telegram ID: ${telegramId}`);
        
        // Optional: Send a success message to the user!
        bot.sendMessage(telegramId, "Payment successful! 🎉 You are now a VIP for 30 days.");
    }

    res.sendStatus(200);
});

// Health Check Route (Required for Render)
app.get("/", (req, res) => {
    res.status(200).send("Bot is Alive and Running on Webhooks! 🚀");
});

// Start the Express Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running and listening on port ${PORT} ✅`);
});

// -------------------
// Cron Job: Remove expired VIPs (Works when awake)
// -------------------
cron.schedule("0 * * * *", async () => {
    const now = new Date();
    const result = await User.updateMany(
        { expiryDate: { $lt: now }, isVIP: true }, 
        { isVIP: false }
    );
    if (result.modifiedCount > 0) {
        console.log(`Expired VIPs removed: ${result.modifiedCount}`);
    }
});