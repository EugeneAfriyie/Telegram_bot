// Eugene Afriyie UEB3502023

require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const mongoose = require("mongoose");
const cron = require("node-cron");

// -------------------
// MongoDB setup
// -------------------
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("MongoDB Connected ✅"))
    .catch(err => console.log(err));

const User = mongoose.model("User", {
    telegramId: String,
    isVIP: Boolean,
    expiryDate: Date
});

// -------------------
// Telegram Bot setup
// -------------------
const bot = new TelegramBot(process.env.TOKEN, { polling: true });

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

    if (query.data === "btc") {
        const user = await User.findOne({ telegramId: query.from.id });
        if (!user || !user.isVIP) {
            return bot.sendMessage(chatId, "You must subscribe to VIP to use this feature 🚫");
        }

        const response = await axios.get("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT");
        bot.sendMessage(chatId, `BTC Price: $${response.data.price}`);
    }

    if (query.data === "vip") {
        const reference = `VIP_${query.from.id}_${Date.now()}`;
        const email = query.from.username ? query.from.username + "@example.com" : "user@example.com";

        try {
            const payResponse = await axios.post(
                "https://api.paystack.co/transaction/initialize",
                {
                    email,
                    amount: 2000 * 100, // $20 in kobo
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
            console.log(err.response?.data || err);
            bot.sendMessage(chatId, "Failed to create payment link. Try again later.");
        }
    }

    bot.answerCallbackQuery(query.id);
});

// -------------------
// Express Webhook for Paystack
// -------------------
const app = express();
app.use(bodyParser.json());

app.post("/paystack/callback", async (req, res) => {
    const event = req.body;

    if (event.event === "charge.success") {
        const ref = event.data.reference;
        const telegramId = ref.split("_")[1]; // encoded in reference

        const expiry = new Date();
        expiry.setDate(expiry.getDate() + 30); // 30-day VIP

        await User.findOneAndUpdate(
            { telegramId },
            { isVIP: true, expiryDate: expiry },
            { upsert: true }
        );

        console.log(`VIP activated for ${telegramId}`);
    }

    res.sendStatus(200);
});

app.listen(process.env.PORT || 3000, () => {
    console.log("Webhook server running...");
});

// -------------------
// Cron Job: Remove expired VIPs every hour
// -------------------
cron.schedule("0 * * * *", async () => {
    const now = new Date();
    await User.updateMany({ expiryDate: { $lt: now } }, { isVIP: false });
    console.log("Expired VIPs removed");
});