const { google } = require('googleapis');

const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const SHEET_ID = process.env.SHEET_ID;
const GOOGLE_CREDENTIALS = process.env.GOOGLE_CREDENTIALS;

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'running',
      token: TOKEN ? 'SET' : 'MISSING',
      chat: CHAT_ID ? 'SET' : 'MISSING',
      sheet: SHEET_ID ? 'SET' : 'MISSING',
      creds: GOOGLE_CREDENTIALS ? 'SET' : 'MISSING'
    });
  }

  try {
    const update = req.body;
    
    if (!update || !update.message) {
      return res.status(200).json({ ok: true, skip: 'no message' });
    }

    const chatId = String(update.message.chat.id);
    const userId = String(update.message.from.id);
    const text = update.message.text || '';

    console.log('Got message:', text, 'from:', userId);

    if (userId !== CHAT_ID) {
      return res.status(200).json({ ok: true, skip: 'wrong user' });
    }

    const cmd = text.split('@')[0].split(' ')[0].toLowerCase();

    if (cmd === '/start') {
      await sendTg(chatId, '👋 Привет! CRM-бот ФС\n\nКоманды:\n/list — все сделки\n/today — задачи на сегодня\n\nДля новой сделки:\nИмя: ...\nТелефон: ...\nНужно: ...\nЦена: ...\nКомментарий: ...');
    } else if (cmd === '/list') {
      await showAllDeals(chatId);
    } else if (cmd === '/today') {
      await showTodayTasks(chatId);
    } else if (text.toLowerCase().startsWith('имя:')) {
      await createDeal(text, chatId);
    } else {
      await sendTg(chatId, 'Не понял. Напишите /start для списка команд');
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('ERROR:', err.message, err.stack);
    return res.status(200).json({ ok: true, error: err.message });
  }
};

async function getSheet() {
  const creds = JSON.parse(GOOGLE_CREDENTIALS);
  const auth = new google.auth.JWT(
    creds.client_email,
    null,
    creds.private_key,
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  const sheets = google.sheets({ version: 'v4', auth });
  return sheets;
}

async function createDeal(text, chatId) {
  const sheets = await getSheet();
  const lines = text.split('\n');
  let name='', phone='', need='', price='', comment='';

  for (const line of lines) {
    const lower = line.toLowerCase();
    const val = line.includes(':') ? line.substring(line.indexOf(':') + 1).trim() : '';
    if (lower.startsWith('имя:')) name = val;
    if (lower.startsWith('телефон:')) phone = val;
    if (lower.startsWith('нужно:')) need = val;
    if (lower.startsWith('цена:')) price = val;
    if (lower.startsWith('комментарий:')) comment = val;
  }

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'A:A'
  });
  const rows = resp.data.values || [];
  const newId = rows.length > 1 ? parseInt(rows[rows.length - 1][0]) + 1 : 1;

  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'A:K',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        newId,
        today.toLocaleDateString('ru-RU'),
        name, phone, need, '', price,
        'Новая заявка',
        tomorrow.toLocaleDateString('ru-RU'),
        comment,
        'Ручной ввод'
      ]]
    }
  });

  await sendTg(chatId, '✅ Сделка #' + newId + ' создана!\n' + name + ' / ' + phone + '\n' + need + ' / ' + price);
}

async function showAllDeals(chatId) {
  const sheets = await getSheet();
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'A:K'
  });
  const rows = resp.data.values || [];
  if (rows.length <= 1) { await sendTg(chatId, 'Сделок пока нет'); return; }

  let msg = '📋 Все сделки:\n\n';
  for (let i = 1; i < rows.length; i++) {
    msg += '#' + rows[i][0] + ' ' + rows[i][2] + ' — ' + rows[i][7] + '\n';
  }
  await sendTg(chatId, msg);
}

async function showTodayTasks(chatId) {
  const sheets = await getSheet();
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'A:K'
  });
  const rows = resp.data.values || [];
  if (rows.length <= 1) { await sendTg(chatId, 'Задач нет'); return; }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let msg = '', count = 0;

  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][8]) continue;
    const parts = rows[i][8].split('.');
    const d = parts.length === 3 ? new Date(parts[2], parts[1]-1, parts[0]) : new Date(rows[i][8]);
    d.setHours(0, 0, 0, 0);
    if (d <= today) {
      count++;
      msg += '#' + rows[i][0] + ' ' + rows[i][2] + ' ' + rows[i][3] + '\n';
    }
  }
  await sendTg(chatId, count > 0 ? '📅 На сегодня:\n\n' + msg : '✅ Задач на сегодня нет');
}

async function sendTg(chatId, text) {
  console.log('Sending to', chatId, ':', text.substring(0, 50));
  const resp = await fetch('https://api.telegram.org/bot' + TOKEN + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text })
  });
  const data = await resp.json();
  console.log('Telegram response:', JSON.stringify(data));
  return data;
}
