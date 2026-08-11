const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const http = require('http');

// 認証成功時にどのサーバー・どのロールを付与するかを一時保存するメモリ用マップ
const pendingVerifications = new Map();

// 1. 簡易HTTPサーバー（Render対策 ＋ ウェブからの認証成功・ロール付与通知用）
const server = http.createServer(async (req, res) => {
    // CORSを許可
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // ウェブページから認証成功の通知を受け取るエンドポイント
    if (req.url === '/api/verify-success' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                const userId = data.userId;
                const token = data.token; // セッション識別用（今回は簡易的にuserIdで紐付け）

                const verificationInfo = pendingVerifications.get(userId);
                if (!verificationInfo) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Verification session expired or not found' }));
                    return;
                }

                const { guildId, roleId } = verificationInfo;

                const guild = await client.guilds.fetch(guildId);
                const member = await guild.members.fetch(userId);

                if (member) {
                    await member.roles.add(roleId);
                    pendingVerifications.delete(userId); // 処理が終わったら削除

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, message: 'Role added successfully' }));
                } else {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Member not found' }));
                }
            } catch (error) {
                console.error("ロール付与エラー:", error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: error.message }));
            }
        });
        return;
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('diCAPTCHA Bot is running!\n');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`HTTPサーバーがポート ${PORT} で起動しました`);
});

// 2. Discord Botの初期化
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// ⚠️ ご自身のFirebase HostingのURLに書き換えてください
const HOSTING_URL = "https://dicaptcha.web.app";

// スラッシュコマンドの定義 (/dicaptcha create authcation:panel role:@ロール)
const commands = [
    new SlashCommandBuilder()
        .setName('dicaptcha')
        .setDescription('diCAPTCHA 認証管理コマンド')
        .setDefaultMemberPermissions(0x8) // 管理者のみ実行可能
        .addSubcommand(subcommand =>
            subcommand
                .setName('create')
                .setDescription('認証パネルを作成します')
                .addStringOption(option =>
                    option.setName('authcation')
                        .setDescription('認証用パネルを設置します')
                        .setRequired(true)
                        .addChoices(
                            { name: 'panel', value: 'panel' }
                        )
                )
                .addRoleOption(option =>
                    option.setName('role')
                        .setDescription('認証成功時に付与するロール')
                        .setRequired(true)
                )
        )
].map(command => command.toJSON());

client.once('clientReady', async () => {
    console.log(`ログインしました: ${client.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('スラッシュコマンドの登録が完了しました！');
    } catch (error) {
        console.error("コマンド登録エラー:", error);
    }
});

client.on('interactionCreate', async interaction => {
    // スラッシュコマンド処理
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'dicaptcha') {
            const subcommandGroup = interaction.options.getSubcommand();
            const optionVal = interaction.options.getString('authcation');
            const targetRole = interaction.options.getRole('role');

            if (subcommandGroup === 'create' && optionVal === 'panel') {
                const embed = new EmbedBuilder()
                    .setTitle("diCAPTCHA 認証システム")
                    .setDescription("下のボタンを押して、メール認証とreCAPTCHAを完了させてください。\n\n**付与されるロール:** " + targetRole.toString())
                    .setColor(0x2ecc71);

                // カスタムIDにロールIDを含めておき、ボタンが押されたときにどのロールを渡すか保持できるようにする
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`open_modal_btn_${targetRole.id}`)
                        .setLabel('認証を開始する')
                        .setStyle(ButtonStyle.Success)
                );

                await interaction.reply({ content: "認証パネルを設置しました。", ephemeral: true });
                await interaction.channel.send({ embeds: [embed], components: [row] });
            }
        }
    }

    // ボタンが押されたらメール入力モーダルを表示 (customIdからロールIDを抽出)
    if (interaction.isButton() && interaction.customId.startsWith('open_modal_btn_')) {
        const roleId = interaction.customId.replace('open_modal_btn_', '');
        
        const modal = new ModalBuilder()
            .setCustomId(`auth_modal_${roleId}`)
            .setTitle('diCAPTCHA メール入力');

        const emailInput = new TextInputBuilder()
            .setCustomId('email_input')
            .setLabel('あなたのメールアドレス')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(emailInput));
        await interaction.showModal(modal);
    }

    // モーダル送信時（メールアドレスを受け取り、URLを生成して案内）
    if (interaction.isModalSubmit() && interaction.customId.startsWith('auth_modal_')) {
        const roleId = interaction.customId.replace('auth_modal_', '');
        const email = interaction.fields.getTextInputValue('email_input');
        
        const passcode = Math.floor(100000 + Math.random() * 900000).toString();
        const userId = interaction.user.id;
        const guildId = interaction.guild.id;

        // サーバーIDとロールIDをサーバー側のメモリに一時保存
        pendingVerifications.set(userId, { guildId, roleId });

        // ウェブサイトへ渡すURL
        const verifyUrl = `${HOSTING_URL}/?id=${userId}&email=${encodeURIComponent(email)}&passcode=${passcode}`;

        await interaction.reply({
            content: `認証用リンクを作成しました。以下のリンクからアクセスしてください。\n${verifyUrl}`,
            ephemeral: true
        });
    }
});

client.login(process.env.DISCORD_BOT_TOKEN);
