"use server";

import nodemailer from "nodemailer";
import nodemailerShim from "@/app/api/auth/send-otp/nodemailer-shim";

export async function sendWithdrawalEmailAction({
  amount,
  bankDetails,
  user,
}: {
  amount: number;
  bankDetails: any;
  user: any;
}) {
  try {
    const rawEmail = process.env.SMTP_EMAIL || "masterstrokeacademy01@gmail.com";
    const rawPass = process.env.SMTP_PASSWORD || "xwuy jkks koeb omsi";
    const rawAdmin = process.env.SMTP_EMAIL || rawEmail;

    const emailUser = rawEmail.trim();
    const emailPass = rawPass.trim().replace(/\s+/g, "");
    const adminEmail = rawAdmin.trim();

    const mailOptions = {
      from: emailUser,
      to: adminEmail,
      subject: `[Withdrawal Request] ₹${amount} - ${user?.fullName || user?.name || user?.email || "User"}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 10px;">
          <h2 style="color: #e31e24; border-bottom: 2px solid #e31e24; padding-bottom: 8px;">New Withdrawal Request</h2>
          <p>A new referral reward withdrawal request has been submitted:</p>
          <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
            <tr><td style="padding: 8px; font-weight: bold; width: 40%;">Amount:</td><td style="padding: 8px; color: #16a34a; font-size: 18px; font-weight: bold;">₹${amount}</td></tr>
            <tr><td style="padding: 8px; font-weight: bold;">User Name:</td><td style="padding: 8px;">${user?.fullName || user?.name || "Unknown"}</td></tr>
            <tr><td style="padding: 8px; font-weight: bold;">User Email:</td><td style="padding: 8px;">${user?.email || "No email"}</td></tr>
          </table>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          <h3 style="color: #333;">Banking Information</h3>
          <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
            <tr><td style="padding: 8px; font-weight: bold; width: 40%;">Account Holder:</td><td style="padding: 8px;">${bankDetails?.accountHolderName || "N/A"}</td></tr>
            <tr><td style="padding: 8px; font-weight: bold;">Account Number:</td><td style="padding: 8px;">${bankDetails?.accountNumber || "N/A"}</td></tr>
            <tr><td style="padding: 8px; font-weight: bold;">IFSC Code:</td><td style="padding: 8px;">${bankDetails?.ifscCode || "N/A"}</td></tr>
            <tr><td style="padding: 8px; font-weight: bold;">Branch Name:</td><td style="padding: 8px;">${bankDetails?.branchName || "N/A"}</td></tr>
            ${bankDetails?.upiId ? `<tr><td style="padding: 8px; font-weight: bold;">UPI ID:</td><td style="padding: 8px;">${bankDetails.upiId}</td></tr>` : ""}
          </table>
          <p style="font-size: 12px; color: #999; margin-top: 20px;">Submitted on: ${new Date().toLocaleString()}</p>
        </div>
      `,
    };

    let messageId = "";
    let responseText = "";

    try {
      const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: {
          user: emailUser,
          pass: emailPass,
        },
      });

      const info = await transporter.sendMail(mailOptions);
      messageId = info.messageId;
      responseText = info.response;
    } catch {
      const shimTransporter = nodemailerShim.createTransport({
        service: "gmail",
        auth: {
          user: emailUser,
          pass: emailPass,
        },
      });
      await shimTransporter.sendMail(mailOptions);
      messageId = "tls-shim-" + Date.now();
      responseText = "Sent via TLS fallback";
    }

    return {
      success: true,
      stage: "completed",
      message: `Email sent successfully to ${adminEmail}`,
      messageId,
      response: responseText,
    };
  } catch (err: any) {
    return {
      success: false,
      stage: "sendMail_exception",
      error: err?.message || String(err),
      code: err?.code || null,
      response: err?.response || null,
    };
  }
}
