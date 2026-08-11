document.addEventListener('DOMContentLoaded', () => {
    // URLパラメータからDiscord ID、メール、電話番号を取得
    const params = new URLSearchParams(window.location.search);
    const discordId = params.get('id');
    const email = params.get('email');
    const phone = params.get('phone');

    // 画面のディスプレイネーム部分を更新（簡易的にIDの下4桁やメールアドレスを表示）
    if (discordId) {
        document.getElementById('display-name').innerText = `ID: ...${discordId.slice(-4)}`;
    }

    // 1. 「認証コードを送信」および「再送信」ボタンの処理
    const handleSendCode = async () => {
        if (!discordId) {
            alert("無効なアクセスです。Discord Botからやり直してください。");
            return;
        }

        // 選択されている方式（email または sms）を取得
        const selectedMethod = document.querySelector('input[name="method"]:checked').value;

        try {
            const response = await fetch('/api/send-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: discordId,
                    email: email || "",
                    phone: phone || "",
                    method: selectedMethod
                })
            });

            const result = await response.json();
            if (result.success) {
                alert("認証コードを送信しました。10分以内にご入力ください。");
            } else {
                alert("エラー: " + result.error);
            }
        } catch (err) {
            console.error(err);
            alert("コードの送信に失敗しました。");
        }
    };

    document.getElementById('send-code-btn').addEventListener('click', handleSendCode);
    document.getElementById('resend-btn').addEventListener('click', handleSendCode);

    // 2. 最終的な「認証」ボタンの処理
    document.getElementById('final-submit-btn').addEventListener('click', async () => {
        const userCode = document.getElementById('auth-code').value.trim();
        const recaptchaToken = grecaptcha.getResponse();

        if (!discordId) {
            alert("Discord IDが見つかりません。");
            return;
        }

        if (!userCode) {
            alert("16文字の認証コードを入力してください。");
            return;
        }

        if (!recaptchaToken) {
            alert("reCAPTCHAを完了してください。");
            return;
        }

        try {
            const response = await fetch('/api/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: discordId,
                    userCode: userCode,
                    recaptchaToken: recaptchaToken
                })
            });

            const result = await response.json();

            if (result.success) {
                // 認証成功時の画面切り替え（画像2枚目の状態を再現）
                document.getElementById('auth-form').innerHTML = `
                    <div style="text-align: center; padding: 20px;">
                        <h2 style="color: #2ecc71;">認証に成功しました</h2>
                        <p>Discordアカウントにロールが付与されました。</p>
                        <p style="color: #666; font-size: 14px;">このウィンドウを閉じてDiscordにお戻りください。</p>
                    </div>
                `;
            } else {
                alert("認証失敗: " + result.error);
                // reCAPTCHAをリセット
                grecaptcha.reset();
            }
        } catch (err) {
            console.error(err);
            alert("通信エラーが発生しました。");
            grecaptcha.reset();
        }
    });
});