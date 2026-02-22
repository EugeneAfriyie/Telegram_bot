// Eugene Afriyie UEB3502023

require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const mongoose = require("mongoose");
const cron = require("node-cron");

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("MongoDB Connected ✅"))
    .catch(err => console.log(err));

// User model
const User = mongoose.model("User", {
    telegramId: String,
    isVIP: Boolean,
    expiryDate: Date
});

// Create Telegram bot
const bot = new TelegramBot(process.env.TOKEN, { polling: true });

// Start command with buttons
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
        // Generate dynamic reference
        const reference = `VIP_${query.from.id}_${Date.now()}`;
        const email = query.from.username ? query.from.username + "@example.com" : "user@example.com";

        // Initialize Paystack payment
        const payResponse = await axios.post(
            "https://api.paystack.co/transaction/initialize",
            {
                email,
                amount: 2000 * 100, // $20 in kobo
                callback_url: `${process.env.BASE_URL}/paystack/callback`,
                reference
            },
            { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`, "Content-Type": "application/json" } }
        );

        const payLink = payResponse.data.data.authorization_url;
        bot.sendMessage(chatId, `Click here to pay VIP: ${payLink}`);
    }

    bot.answerCallbackQuery(query.id);
});

// Cron job to remove expired VIPs every hour
cron.schedule("0 * * * *", async () => {
    const now = new Date();
    await User.updateMany({ expiryDate: { $lt: now } }, { isVIP: false });
    console.log("Expired VIPs removed");
});

console.log("Telegram bot running...");