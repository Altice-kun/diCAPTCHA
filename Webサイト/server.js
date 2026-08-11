const express = require('express');
const admin = require('firebase-admin');
const axios = require('axios');
const app = express();

admin.initializeApp();
const db = admin.firestore();

app.use(express.json());

// 1. 認証コード送信API
app.post('/api/send-code', async (req, res) => {
    const { id, email, phone, method } = req.body;
    const code = Math.random().toString(36).substring(2, 10).toUpperCase() + '-' + Math.random().toString(36).substring(2, 10).toUpperCase();
    const expiry = new Date(Date.now() + 10 * 60 * 1000); // 10分後

    await db.collection('verifications').doc(id).set({
        code, expiry, email, phone, verified: false
    });

    // ここでSendGrid(メール)やTwilio(SMS)のAPIを呼び出す
    console.log(`送信先: ${method === 'email' ? email : phone}, コード: ${code}`);
    res.json({ success: true });
});

// 2. 認証実行API（reCAPTCHA検証付き）
app.post('/api/verify', async (req, res) => {
    const { id, userCode, recaptchaToken } = req.body;
    const secret = '6LeBUH4tAAAAAHKEe4ygMangBolkr0gGEE6mc5A_';

    // reCAPTCHA検証
    const vRes = await axios.post(`https://www.google.com/recaptcha/api/siteverify?secret=${secret}&response=${recaptchaToken}`);
    if (!vRes.data.success) return res.status(400).json({ error: 'reCAPTCHA failed' });

    // コード検証
    const doc = await db.collection('verifications').doc(id).get();
    if (!doc.exists || doc.data().code !== userCode || new Date() > doc.data().expiry.toDate()) {
        return res.status(400).json({ error: 'コードが不正または期限切れです' });
    }

    // 認証成功処理（ここでDiscord APIを叩く）
    await db.collection('verifications').doc(id).update({ verified: true });
    res.json({ success: true });
});

module.exports = app;