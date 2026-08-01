// Mock nodemailer before requiring the module
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    verify: jest.fn().mockResolvedValue(true),
    sendMail: jest.fn()
  }))
}));

describe('sendEmail', () => {
  let sendEmail;
  let nodemailer;

  describe('when SMTP is not configured', () => {
    beforeEach(() => {
      jest.resetModules();
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;

      jest.mock('nodemailer', () => ({
        createTransport: jest.fn(() => ({
          verify: jest.fn().mockResolvedValue(true),
          sendMail: jest.fn()
        }))
      }));

      sendEmail = require('../utils/email');
    });

    test('returns false when SMTP is not configured', async () => {
      const result = await sendEmail({
        to: 'user@test.com',
        subject: 'Test',
        html: '<p>Hello</p>'
      });
      expect(result).toBe(false);
    });

    test('returns false when "to" is not provided', async () => {
      const result = await sendEmail({
        subject: 'Test',
        html: '<p>Hello</p>'
      });
      expect(result).toBe(false);
    });
  });

  describe('when SMTP is configured', () => {
    let mockSendMail;

    beforeEach(() => {
      jest.resetModules();
      process.env.SMTP_HOST = 'smtp.test.com';
      process.env.SMTP_PORT = '587';
      process.env.SMTP_USER = 'user@test.com';
      process.env.SMTP_PASS = 'password';
      process.env.SMTP_FROM = 'noreply@test.com';
      process.env.SMTP_FROM_NAME = 'TestApp';

      mockSendMail = jest.fn().mockResolvedValue({ messageId: 'msg-123' });

      jest.mock('nodemailer', () => ({
        createTransport: jest.fn(() => ({
          verify: jest.fn().mockResolvedValue(true),
          sendMail: mockSendMail
        }))
      }));

      sendEmail = require('../utils/email');
    });

    test('sends email successfully', async () => {
      const result = await sendEmail({
        to: 'recipient@test.com',
        subject: 'Hello',
        html: '<p>World</p>'
      });
      expect(result).toBe(true);
    });

    test('calls sendMail with correct options', async () => {
      await sendEmail({
        to: 'recipient@test.com',
        subject: 'Test Subject',
        html: '<p>HTML body</p>',
        text: 'Plain text body'
      });

      expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
        to: 'recipient@test.com',
        subject: 'Test Subject',
        html: '<p>HTML body</p>',
        text: 'Plain text body',
        priority: 'high'
      }));
    });

    test('sets from field with name when SMTP_FROM is configured', async () => {
      await sendEmail({
        to: 'recipient@test.com',
        subject: 'Test',
        html: '<p>Test</p>'
      });

      const callArgs = mockSendMail.mock.calls[0][0];
      expect(callArgs.from).toBe('"TestApp" <noreply@test.com>');
    });

    test('returns false when sendMail throws', async () => {
      mockSendMail.mockRejectedValue(new Error('SMTP connection failed'));

      const result = await sendEmail({
        to: 'recipient@test.com',
        subject: 'Test',
        html: '<p>Test</p>'
      });
      expect(result).toBe(false);
    });

    test('returns false when "to" is empty', async () => {
      const result = await sendEmail({
        to: '',
        subject: 'Test',
        html: '<p>Test</p>'
      });
      expect(result).toBe(false);
    });
  });
});
