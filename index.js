// ===============================
// Eugene Production VIP Bot
// ===============================

require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const axios = require("axios");
const mongoose = require("mongoose");
const cron = require("node-cron");
const crypto = require("crypto");

// ===============================
// MongoDB Setup
// ===============================

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("MongoDB Connected ✅"))
    .catch(err => console.log("MongoDB Error:", err.message));

const userSchema = new mongoose.Schema({
    telegramId: { type: String, unique: true, index: true },
    isVIP: { type: Boolean, default: false },
    expiryDate: Date
}, { timestamps: true });

const User = mongoose.model("User", userSchema);

// -------------------
// BTC Price Cache (Avoid 429 Errors)
// -------------------
let cachedBTCPrice = null;
let lastUpdated = null;

async function updateBTC() {
    try {
        const response = await axios.get(
            "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
        );

        cachedBTCPrice = response.data.bitcoin.usd;
        lastUpdated = new Date();

        console.log("BTC price updated:", cachedBTCPrice);
    } catch (err) {
        console.log("BTC update failed:", err.message);
    }
}

// Run immediately when server starts
updateBTC();

// Update every 10 minutes
cron.schedule("*/10 * * * *", updateBTC);

// ===============================
// Bot Setup (Webhook Mode)
// ===============================

const TOKEN = process.env.TOKEN;
const BASE_URL = process.env.BASE_URL;
const VIP_GROUP = process.env.VIP_GROUP; // @yourvipgroup

const bot = new TelegramBot(TOKEN);
bot.setWebHook(`${BASE_URL}/bot${TOKEN}`);

// ===============================
// Start Command
// ===============================

bot.onText(/\/start/, async (msg) => {
    await User.findOneAndUpdate(
        { telegramId: msg.from.id },
        { telegramId: msg.from.id },
        { upsert: true }
    );

    bot.sendMessage(msg.chat.id, "Welcome Eugene 🚀 Choose an option:", {
        reply_markup: {
            inline_keyboard: [
                [{ text: "BTC Price 💰", callback_data: "btc" }],
                [{ text: "VIP Subscription 🔥", callback_data: "vip" }]
            ]
        }
    });
});

// ===============================
// Button Handling
// ===============================

bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;
    const telegramId = query.from.id.toString();

    await bot.answerCallbackQuery(query.id).catch(() => {});

    try {
      if (query.data === "btc") {

    const user = await User.findOne({ telegramId });
    const now = new Date();

    if (!user || !user.isVIP || (user.expiryDate && user.expiryDate < now)) {
        return bot.sendMessage(chatId, "VIP required or expired 🚫");
    }

    try {
      if (!cachedBTCPrice) {
    return bot.sendMessage(chatId, "Price not available yet. Try again in a few seconds.");
}

bot.sendMessage(
    chatId,
    `BTC Price: $${cachedBTCPrice.toLocaleString()} \nLast Updated: ${lastUpdated.toLocaleTimeString()}`
);

    } catch (err) {
        console.log("Price fetch error:", err.message);
        bot.sendMessage(chatId, "Could not fetch BTC price right now.");
    }
}
     if (query.data === "vip") {

    const telegramId = query.from.id.toString();
    const user = await User.findOne({ telegramId });
    const now = new Date();

    // ✅ If already VIP and not expired
    if (user && user.isVIP && user.expiryDate && user.expiryDate > now) {
        return bot.sendMessage(
            chatId,
            `You are already VIP ✅
Expires on: ${user.expiryDate.toDateString()}`
        );
    }

    // 🔥 Otherwise generate payment link
    const reference = `VIP_${telegramId}_${Date.now()}`;

    const payResponse = await axios.post(
        "https://api.paystack.co/transaction/initialize",
        {
            email: `${telegramId}@vipuser.com`,
            amount: 2000 * 100,
            callback_url: `${process.env.BASE_URL}/payment-success`,
            reference
        },
        {
            headers: {
                Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
                "Content-Type": "application/json"
            }
        }
    );

    bot.sendMessage(
        chatId,
        `Pay VIP here 🔥:\n${payResponse.data.data.authorization_url}`
    );
}

    } catch (err) {
        console.log("Callback Error:", err.message);
        bot.sendMessage(chatId, "Something went wrong.");
    }
});

// ===============================
// Express Setup
// ===============================

const app = express();
app.use(express.json());

// Telegram webhook route
app.post(`/bot${TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// ===============================
// Payment Success Page (User Redirect)
// ===============================

app.get("/payment-success", (req, res) => {
    res.send(`
        <html>
            <body style="font-family: Arial; text-align:center; padding:50px;">
                <h2>Payment Successful 🎉</h2>
                <p>You can now return to Telegram.</p>
            </body>
        </html>
    `);
});

// ===============================
// Paystack Webhook (SECURE)
// ===============================

app.post("/paystack-webhook", async (req, res) => {

    const hash = crypto
        .createHmac("sha512", process.env.PAYSTACK_SECRET)
        .update(JSON.stringify(req.body))
        .digest("hex");

    if (hash !== req.headers["x-paystack-signature"]) {
        console.log("Invalid Paystack signature ⚠️");
        return res.sendStatus(401);
    }

    const event = req.body;

    if (event.event === "charge.success") {

        const reference = event.data.reference;
        const telegramId = reference.split("_")[1];

        let user = await User.findOne({ telegramId });

        let expiry;

        if (user && user.expiryDate && user.expiryDate > new Date()) {
            expiry = new Date(user.expiryDate);
            expiry.setDate(expiry.getDate() + 30);
        } else {
            expiry = new Date();
            expiry.setDate(expiry.getDate() + 30);
        }

        await User.findOneAndUpdate(
            { telegramId },
            { isVIP: true, expiryDate: expiry },
            { upsert: true }
        );

        try {
            await bot.sendMessage(
                telegramId,
                `VIP Activated ✅\nExpires: ${expiry.toDateString()}`
            );
        } catch (err) {
            console.log("Telegram send error:", err.message);
        }

        console.log("VIP activated for:", telegramId);
    }

    res.sendStatus(200);
});

// ===============================
// Health Check
// ===============================

app.get("/", (req, res) => {
    res.send("Bot Running 🚀");
});

// ===============================
// Cron Job (Remove Expired VIPs)
// ===============================

cron.schedule("0 * * * *", async () => {
    try {
        const now = new Date();

        const expiredUsers = await User.find({
            expiryDate: { $lt: now },
            isVIP: true
        });

        for (const user of expiredUsers) {
            user.isVIP = false;
            await user.save();

            try {
                if (VIP_GROUP) {
                    await bot.banChatMember(VIP_GROUP, user.telegramId);
                    await bot.unbanChatMember(VIP_GROUP, user.telegramId);
                }
            } catch (err) {
                console.log("Group removal error:", err.message);
            }

            await bot.sendMessage(
                user.telegramId,
                "Your VIP has expired ⏰ Renew to continue."
            );
        }

        if (expiredUsers.length > 0) {
            console.log(`Expired VIPs removed: ${expiredUsers.length}`);
        }

    } catch (err) {
        console.log("Cron error:", err.message);
    }
});

// ===============================
// Start Server
// ===============================

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT} ✅`);
});