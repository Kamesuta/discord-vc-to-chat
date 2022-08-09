const { joinVoiceChannel, getVoiceConnection } = require("@discordjs/voice");
const { Client, Intents, GuildMember, Permissions } = require("discord.js");
const { SlashCommandBuilder } = require("@discordjs/builders");
const { addSpeechEvent } = require("discord-speech-recognition");
const { token } = require("./config.json");

// クライアントを初期化
const client = new Client({
  intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_VOICE_STATES],
});
// 音声認識を初期化 (日本語)
addSpeechEvent(client, { lang: "ja-JP" });

// スラッシュコマンドを構築
const recordingCommand = new SlashCommandBuilder()
  .setName('recording')
  .setDescription('議事録の記録を行います')
  .setDefaultMemberPermissions(Permissions.FLAGS.MOVE_MEMBERS)
  .addSubcommand((subcommand) =>
    // /recording start
    subcommand.setName('start').setDescription('議事録の記録を開始します'),
  )
  .addSubcommand((subcommand) =>
    // /recording stop
    subcommand.setName('stop').setDescription('議事録の記録終了します'),
  );

// スラッシュコマンドを登録
client.on("ready", async () => {
  client.api.applications(client.user.id).commands.post({ data: recordingCommand.toJSON() });
  console.log("起動しました: " + client.user.tag);
});

// ギルドID -> スレッド のマップ
const sessionThreads = {};

// スラッシュコマンドを処理
client.on("interactionCreate", async (interaction) => {
  // スラッシュコマンド以外
  if (!interaction.isCommand()) return;

  // /recording
  if (interaction.commandName === 'recording') {
    // /recording start
    if (interaction.options.getSubcommand() === 'start') {
      // BotがVCに入っているかチェック
      const connection = getVoiceConnection(interaction.guildId);
      if (connection) {
        // VCに入っている
        await interaction.reply("すでに議事録の記録中です\n終了してから再度実行してください");
      } else {
        // VCに入っていない場合、VCに参加
        if (
          interaction.member instanceof GuildMember &&
          interaction.member.voice.channel
        ) {
          // VCに参加
          const voiceChannel = interaction.member.voice.channel;
          joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: voiceChannel.guild.id,
            selfDeaf: false,
            selfMute: true,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
          });
          // 議事録のスレッドを作成
          const startTime = Date.now();
          const startDate = new Date(startTime).toISOString().replace(/T/, ' ').replace(/\..+/, '');
          const startMessage = `💬 ${interaction.member.displayName} が議事録の記録を開始しました`;
          const channelMessage = await interaction.channel.send(startMessage);
          const sessionThread = await channelMessage.startThread({
            name: `💬 ${startDate}`.replace(/:/g, '-'),
            autoArchiveDuration: 60,
            reason: startMessage,
          });
          // マップに追加
          sessionThreads[interaction.guildId] = sessionThread;

          await interaction.reply("議事録の記録を開始しました");
        } else {
          await interaction.reply("VCに入ってからコマンドを使用してください");
        }
      }
    } else if (interaction.options.getSubcommand() === 'stop') {
      // BotがVCに入っているかチェック
      const connection = getVoiceConnection(interaction.guildId);
      if (!connection) {
        // VCに入っていない
        await interaction.reply("議事録の記録中ではありません");
      } else {
        // VCに入っている場合、VCから退出
        connection.destroy();
        // 議事録のスレッドを取得
        const sessionThread = sessionThreads[interaction.guildId];
        // アーカイブしたあとにスレッドに書き込めなくなるためこのタイミングで送信
        await interaction.reply("議事録の記録を終了しました");
        if (sessionThread) {
          // アーカイブ化
          await sessionThread.setArchived(true);
          // マップから削除
          sessionThreads[interaction.guildId] = null;    
        }
      }
    }
  }
});

// VC発言時の処理
client.on("speech", async (msg) => {
  // 認識に失敗した場合は無視
  if (!msg.content) return;

  // スレッドを取得
  const sessionThread = sessionThreads[msg.guild.id];
  if (sessionThread) {
    // メッセージを送信
    const message = `\`${msg.member.displayName}\`: \`${msg.content}\``;
    await sessionThread.send(message);
  }
});

// Botの起動
client.login(token);
