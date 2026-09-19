/**
 * Minimal ambient typings for the subset of the Office.js Outlook API this add-in
 * uses. Office.js itself is loaded from Microsoft's CDN in outlook/taskpane.html
 * (it must not be bundled). See https://learn.microsoft.com/office/dev/add-ins/reference/overview/outlook-add-ins-reference-overview
 */
declare namespace Office {
  enum AsyncResultStatus {
    Succeeded = 'succeeded',
    Failed = 'failed',
  }
  enum CoercionType {
    Text = 'text',
    Html = 'html',
  }
  enum EventType {
    ItemChanged = 'olkItemChanged',
  }
  enum MailboxEnums {}

  interface Error {
    code: number;
    message: string;
    name: string;
  }

  interface AsyncResult<T> {
    status: AsyncResultStatus;
    value: T;
    error?: Error;
  }

  interface EmailAddressDetails {
    displayName: string;
    emailAddress: string;
  }

  interface AttachmentDetails {
    id: string;
    name: string;
    size: number;
    contentType?: string;
    attachmentType: string;
    isInline: boolean;
  }

  interface Body {
    getAsync(coercionType: CoercionType | 'text' | 'html', callback: (result: AsyncResult<string>) => void): void;
  }

  interface MessageRead {
    itemType: string;
    /** Exchange Web Services item id (stable within the mailbox). */
    itemId?: string;
    conversationId?: string;
    subject: string;
    from?: EmailAddressDetails;
    sender?: EmailAddressDetails;
    to?: EmailAddressDetails[];
    cc?: EmailAddressDetails[];
    attachments?: AttachmentDetails[];
    body: Body;
    internetMessageId?: string;
    dateTimeCreated?: Date;
  }

  interface UserProfile {
    displayName?: string;
    emailAddress?: string;
  }

  interface Mailbox {
    item?: MessageRead | null;
    userProfile?: UserProfile;
    diagnostics?: { hostName?: string; hostVersion?: string };
    addHandlerAsync(eventType: EventType, handler: () => void, callback?: (result: AsyncResult<void>) => void): void;
  }

  interface Requirements {
    isSetSupported(name: string, minVersion?: string): boolean;
  }

  interface Context {
    mailbox?: Mailbox;
    requirements?: Requirements;
    host?: string | null;
    platform?: string | null;
  }

  interface OnReadyInfo {
    host: string | null;
    platform: string | null;
  }

  const context: Context;
  function onReady(callback?: (info: OnReadyInfo) => void): Promise<OnReadyInfo>;
}

interface Window {
  Office?: typeof Office;
}
