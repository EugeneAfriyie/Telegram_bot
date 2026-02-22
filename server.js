// Eugene Afriyie UEB3502023

require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");

const app = express();
app.use(bodyParser.json());

// Connect MongoDB
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("MongoDB Connected ✅"))
    .catch(err => console.log(err));

const User = mongoose.model("User", {
    telegramId: String,
    isVIP: Boolean,
    expiryDate: Date
});

// Paystack webhook
app.post("/paystack/callback", async (req, res) => {
    const event = req.body;

    if (event.event === "charge.success") {
        const ref = event.data.reference;
        const telegramId = ref.split("_")[1]; // we encoded in reference

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

app.listen(3000, () => console.log("Webhook server running on port 3000"));