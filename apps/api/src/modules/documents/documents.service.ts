import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as nodemailer from 'nodemailer';

export interface SendEmailInput {
  to: string;
  subject: string;
  body: string;
  quoteId?: string;
  attachments?: { filename: string; path: string }[];
}

@Injectable()
export class DocumentsService {
  private transporter: nodemailer.Transporter;

  constructor(private prisma: PrismaService) {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'localhost',
      port: parseInt(process.env.SMTP_PORT || '1025'),
      secure: false,
      auth: process.env.SMTP_USER ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      } : undefined,
    });
  }

  async generateQuotePdf(quoteId: string): Promise<any> {
    const quote = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      include: { customer: true },
    });

    if (!quote) throw new Error('Quote not found');

    return {
      id: quoteId,
      url: `/api/pdf/quote/${quoteId}`,
      contentType: 'application/pdf',
      success: true,
    };
  }

  async sendQuoteEmail(input: SendEmailInput) {
    const { quoteId, ...emailData } = input;
    
    const info = await this.transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@marblepark.in',
      ...emailData,
    });

    if (quoteId) {
      await this.prisma.quote.update({
        where: { id: quoteId },
        data: { sentAt: new Date(), status: 'sent' },
      });
    }

    return { messageId: info.messageId, success: true };
  }

  private buildQuoteHtml(quote: any, lines: any[]): string {
    const lineItems = lines.map((line, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${line.sku || ''}</td>
        <td>${line.description || ''}</td>
        <td style="text-align:center">${line.quantity || 0}</td>
        <td style="text-align:right">₹${(line.rate || 0).toLocaleString('en-IN')}</td>
        <td style="text-align:right">₹${((line.quantity || 0) * (line.rate || 0)).toLocaleString('en-IN')}</td>
      </tr>
    `).join('');

    const subtotal = lines.reduce((sum, line) => sum + ((line.quantity || 0) * (line.rate || 0)), 0);
    const discount = (quote.discountPercent || 0) / 100 * subtotal;
    const taxable = subtotal - discount;
    const tax = taxable * 0.18;
    const total = taxable + tax;

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12px; color: #333; }
    .header { background: linear-gradient(135deg, #1a365d 0%, #2d4a7c 100%); color: white; padding: 30px; }
    .header h1 { font-size: 28px; margin-bottom: 5px; }
    .header p { opacity: 0.9; font-size: 11px; }
    .content { padding: 30px; }
    .info-grid { display: table; width: 100%; margin-bottom: 20px; }
    .info-grid > div { display: table-row; }
    .info-grid label { display: table-cell; font-weight: 600; color: #666; padding: 5px 10px 5px 0; width: 120px; }
    .info-grid span { display: table-cell; padding: 5px 0; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    th { background: #f8f9fa; padding: 12px 8px; text-align: left; font-weight: 600; border-bottom: 2px solid #1a365d; }
    td { padding: 10px 8px; border-bottom: 1px solid #eee; }
    .totals { margin-left: auto; width: 300px; }
    .totals td { padding: 6px 0; }
    .totals .label { color: #666; }
    .totals .value { text-align: right; }
    .totals tr.total { font-size: 16px; font-weight: 700; color: #1a365d; }
    .footer { background: #f8f9fa; padding: 20px 30px; font-size: 10px; color: #666; }
  </style>
</head>
<body>
  <div class="header">
    <h1>MARBLE PARK</h1>
    <p>Premium Bath Solutions | GSTIN: Configure in settings | Ph: Configure in settings</p>
  </div>
  <div class="content">
    <h2 style="margin-bottom: 20px; color: #1a365d; border-bottom: 2px solid #1a365d; padding-bottom: 10px;">
      QUOTATION
    </h2>
    <div class="info-grid">
      <div><label>Quote No:</label><span>${quote.quoteNumber}</span></div>
      <div><label>Date:</label><span>${new Date(quote.createdAt).toLocaleDateString('en-IN')}</span></div>
      <div><label>Valid Until:</label><span>${new Date(quote.validUntil).toLocaleDateString('en-IN')}</span></div>
      <div><label>Project:</label><span>${quote.projectName || '-'}</span></div>
      <div><label>Customer:</label><span>${quote.customer.name}</span></div>
      <div><label>Company:</label><span>${quote.customer.companyName || '-'}</span></div>
    </div>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>SKU</th>
          <th>Description</th>
          <th style="text-align:center">Qty</th>
          <th style="text-align:right">Rate</th>
          <th style="text-align:right">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${lineItems || '<tr><td colspan="6" style="text-align:center;color:#999;">No items</td></tr>'}
      </tbody>
    </table>
    <table class="totals">
      <tr><td class="label">Subtotal</td><td class="value">₹${subtotal.toLocaleString('en-IN')}</td></tr>
      ${discount > 0 ? `<tr><td class="label">Discount (${quote.discountPercent}%)</td><td class="value">-₹${discount.toLocaleString('en-IN')}</td></tr>` : ''}
      <tr><td class="label">CGST (9%)</td><td class="value">₹${(tax/2).toLocaleString('en-IN')}</td></tr>
      <tr><td class="label">SGST (9%)</td><td class="value">₹${(tax/2).toLocaleString('en-IN')}</td></tr>
      <tr class="total"><td>TOTAL</td><td>₹${total.toLocaleString('en-IN')}</td></tr>
    </table>
    ${quote.notes ? `<div style="margin-top:20px;padding:15px;background:#f8f9fa;border-left:3px solid #1a365d;"><strong>Notes:</strong><br>${quote.notes}</div>` : ''}
  </div>
  <div class="footer">
    <p>This is a computer-generated document. No signature required.</p>
    <p>Marble Park | Configure address, GST and email in system settings</p>
  </div>
</body>
</html>`;
  }
}
