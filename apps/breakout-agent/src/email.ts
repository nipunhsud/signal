import nodemailer from 'nodemailer';

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (transporter) return transporter;

  const service = process.env.EMAIL_SERVICE || 'gmail';
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  if (!user || !pass) {
    console.error('❌ Email config error: EMAIL_USER or EMAIL_PASS not set');
    throw new Error('EMAIL_USER and EMAIL_PASS not configured');
  }

  console.log(`📧 Email config: service=${service}, user=${user}, pass=${pass ? '***' : 'empty'}`);

  transporter = nodemailer.createTransport({
    service,
    auth: { user, pass },
  });

  return transporter;
}

export async function sendEmail(subject: string, body: string): Promise<void> {
  const to = process.env.ALERT_EMAIL || process.env.EMAIL_USER;

  if (!to) {
    console.warn('ALERT_EMAIL not set, skipping email');
    return;
  }

  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to,
      subject,
      text: body,
      html: `<pre>${body}</pre>`,
    });

    console.log(`✓ Email sent: ${subject}`);
  } catch (error) {
    console.error('Failed to send email:', error);
  }
}
