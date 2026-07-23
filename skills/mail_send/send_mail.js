import nodemailer from "nodemailer";

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  });
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const raw = await readStdin();

let args;
try {
  args = JSON.parse(raw || "{}");
} catch (err) {
  fail(`Invalid JSON args: ${err.message}`);
}

const { EMAIL_TO, EMAIL_FROM, EMAIL_SMTP_SERVER, EMAIL_SMTP_PORT, EMAIL_SMTP_USER, EMAIL_SMTP_PASSWORD } =
  process.env;

if (!EMAIL_SMTP_SERVER || !EMAIL_SMTP_USER || !EMAIL_SMTP_PASSWORD) {
  fail(
    "EMAIL_SMTP_SERVER, EMAIL_SMTP_USER, and EMAIL_SMTP_PASSWORD must be set (in the project's .env). See README for setup.",
  );
}

const to = args.to || EMAIL_TO;
if (!to) fail("No recipient: pass `to`, or set EMAIL_TO as a default in .env.");
if (!args.subject || !args.body) fail("subject and body are both required.");

const port = Number(EMAIL_SMTP_PORT || 587);
const transporter = nodemailer.createTransport({
  host: EMAIL_SMTP_SERVER,
  port,
  secure: port === 465, // 465 = implicit TLS; 587/others negotiate STARTTLS automatically
  auth: { user: EMAIL_SMTP_USER, pass: EMAIL_SMTP_PASSWORD },
});

try {
  const info = await transporter.sendMail({
    from: EMAIL_FROM || EMAIL_SMTP_USER,
    to,
    subject: args.subject,
    text: args.body,
  });
  console.log(`Sent mail to ${to} (messageId: ${info.messageId})`);
} catch (err) {
  fail(`Failed to send mail: ${err.message}`);
}
