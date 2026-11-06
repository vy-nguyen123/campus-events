import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp, validEvent } from '../helpers/testApp.mjs';
import { confirmationMailer, createConfirmationMailer } from '../../src/mail/confirmationMailer.mjs';
import { env } from '../../src/config/env.mjs';
import { logger } from '../../src/config/logger.mjs';

const mailConfig = {
  enabled: true,
  from: 'Campus Events <events@example.com>',
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  timeoutMs: 1000
};

describe('Registration confirmation emails', () => {
  let app;
  let event;
  let url;

  beforeEach(async () => {
    ({ app } = await createTestApp());
    const created = await request(app).post('/api/events').send(validEvent());
    event = created.body;
    url = `/api/events/${event.id}/registrations`;
  });

  async function registerAndCheckPersistence() {
    const response = await request(app).post(url).send({ name: 'Ada', email: 'ADA@example.com' });
    assert.equal(response.status, 201);
    assert.equal(response.body.eventId, event.id);
    assert.equal(response.body.name, 'Ada');
    assert.equal(response.body.email, 'ada@example.com');
    assert.ok(response.body.id);
    assert.ok(response.body.createdAt);
    assert.ok(response.body.updatedAt);

    const listed = await request(app).get(url);
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body, [response.body]);
    const detail = await request(app).get(`/api/events/${event.id}`);
    assert.equal(detail.body.registered, 1);
    assert.equal(detail.body.spotsLeft, event.capacity - 1);
    return response;
  }

  function useMailer(t, config, createTransport) {
    const mailer = createConfirmationMailer(config, createTransport);
    return t.mock.method(confirmationMailer, 'sendConfirmation', mailer.sendConfirmation);
  }

  it('sends the confirmation only after persistence and preserves the 201 response', async (t) => {
    const messages = [];
    let options;
    const send = useMailer(t, mailConfig, (transportOptions) => {
      options = transportOptions;
      return {
        async sendMail(message) {
          // Observe the real database through HTTP while the mail attempt is running.
          const listed = await request(app).get(url);
          assert.equal(listed.body.length, 1);
          assert.equal(listed.body[0].email, message.to);
          messages.push(message);
        }
      };
    });

    await registerAndCheckPersistence();
    assert.equal(send.mock.callCount(), 1);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].to, 'ada@example.com');
    assert.equal(messages[0].from, mailConfig.from);
    assert.equal(messages[0].subject, 'Registration confirmed: ' + event.title);
    assert.ok(messages[0].text.includes('Hello Ada,'));
    assert.ok(messages[0].text.includes(event.location));
    assert.ok(messages[0].text.includes(event.startsAt));
    assert.equal(options.host, mailConfig.host);
    assert.equal(options.port, 587);
    assert.equal(options.connectionTimeout, 1000);
    assert.equal(options.greetingTimeout, 1000);
    assert.equal(options.socketTimeout, 1000);
    assert.equal(options.dnsTimeout, 1000);
  });

  it('returns 201 and keeps the saved registration when SMTP is offline', async (t) => {
    const warning = t.mock.method(logger, 'warn', () => {});
    const send = useMailer(t, mailConfig, () => ({
      async sendMail() {
        throw Object.assign(new Error('SMTP unavailable'), { code: 'ECONNREFUSED' });
      }
    }));

    const response = await registerAndCheckPersistence();
    assert.equal(send.mock.callCount(), 1);
    assert.equal(warning.mock.callCount(), 1);
    assert.deepEqual(warning.mock.calls[0].arguments, [
      'Confirmation email failed',
      { registrationId: response.body.id, eventId: event.id, code: 'ECONNREFUSED' }
    ]);
  });

  it('keeps the registration when transport construction throws synchronously', async (t) => {
    const send = useMailer(t, mailConfig, () => {
      throw new Error('Transport configuration failed');
    });
    await registerAndCheckPersistence();
    assert.equal(send.mock.callCount(), 1);
  });

  for (const [label, overrides] of [
    ['missing SMTP host', { host: '' }],
    ['invalid port', { port: NaN }],
    ['invalid timeout', { timeoutMs: 0 }]
  ]) {
    it(`keeps the registration with ${label}`, async (t) => {
      let transportCreated = false;
      const send = useMailer(t, { ...mailConfig, ...overrides }, () => {
        transportCreated = true;
        throw new Error('Invalid configuration must not reach the transport');
      });
      const warning = t.mock.method(logger, 'warn', () => {});
      await registerAndCheckPersistence();
      assert.equal(send.mock.callCount(), 1);
      assert.equal(warning.mock.callCount(), 1);
      assert.equal(transportCreated, false);
    });
  }

  it('does not send an email or save a registration for invalid input', async (t) => {
    const send = t.mock.method(confirmationMailer, 'sendConfirmation', async () => {});
    const response = await request(app).post(url).send({ name: 'Ada', email: 'invalid' });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    assert.equal(send.mock.callCount(), 0);
    const listed = await request(app).get(url);
    assert.deepEqual(listed.body, []);
  });

  it('does not send another email for a duplicate registration', async (t) => {
    const send = t.mock.method(confirmationMailer, 'sendConfirmation', async () => {});
    await registerAndCheckPersistence();
    const response = await request(app).post(url).send({ name: 'Ada', email: 'ada@example.com' });
    assert.equal(response.status, 409);
    assert.equal(send.mock.callCount(), 1);
    const listed = await request(app).get(url);
    assert.equal(listed.body.length, 1);
  });

  it('does not send an email for an unknown event', async (t) => {
    const send = t.mock.method(confirmationMailer, 'sendConfirmation', async () => {});
    const response = await request(app).post('/api/events/999/registrations')
      .send({ name: 'Ada', email: 'ada@example.com' });
    assert.equal(response.status, 404);
    assert.equal(send.mock.callCount(), 0);
  });

  it('disables the configured mailer during automated tests without creating a transport', async (t) => {
    assert.equal(env.isTest, true);
    assert.equal(env.mail.enabled, false);
    let transportCreated = false;
    useMailer(t, env.mail, () => {
      transportCreated = true;
      throw new Error('Tests must not create an SMTP transport');
    });
    await registerAndCheckPersistence();
    assert.equal(transportCreated, false);
  });
});
