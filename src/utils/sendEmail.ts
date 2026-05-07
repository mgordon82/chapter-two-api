import { SendEmailCommand } from '@aws-sdk/client-ses';
import { ses } from '../config/ses';

const fromEmail = process.env.SES_FROM_EMAIL;

if (!fromEmail) {
  throw new Error('Missing SES_FROM_EMAIL');
}

type SendEmailArgs = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export async function sendEmail({ to, subject, html, text }: SendEmailArgs) {
  await ses.send(
    new SendEmailCommand({
      Source: fromEmail,
      Destination: {
        ToAddresses: [to]
      },
      Message: {
        Subject: {
          Data: subject,
          Charset: 'UTF-8'
        },
        Body: {
          Html: {
            Data: html,
            Charset: 'UTF-8'
          },
          Text: {
            Data: text,
            Charset: 'UTF-8'
          }
        }
      }
    })
  );
}
