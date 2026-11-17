//! A document send (docs/api.md, 「Sends」): a file that arrived as a part, held on disk, goes to the gateway
//! inline, and one larger than the dialect's file limit is refused by its size without the gateway being asked.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use axum::Router;
use axum::http::StatusCode;
use axum::routing::post;
use bmo_chat::{ChatProvider, ChatRefusal, ChatSend, ChatSendRequest, ChatSendResult, FileBody};
use bmo_discord::policy::POLICY;
use serde_json::json;

use crate::stand_in::{closed_port, gateway, provider};

const ROOM: i64 = -8_000_000_000_000;

/// A file in the system's temporary directory, removed when the test lets go of it.
struct Spooled(PathBuf);

impl Spooled {
  fn new(name: &str) -> Self {
    Self(std::env::temp_dir().join(format!("bmo-discord-{name}-{}", std::process::id())))
  }
}

impl Drop for Spooled {
  fn drop(&mut self) {
    let _ = std::fs::remove_file(&self.0);
  }
}

fn document(bytes: FileBody) -> ChatSendRequest {
  ChatSendRequest {
    room_id: ROOM,
    send: ChatSend::Document {
      bytes,
      file_name: "notes.txt".to_owned(),
    },
    mode: None,
    speaker: None,
    tag: None,
    prefix: None,
    reply_to_message_id: None,
    account_id: None,
  }
}

/// A stand-in gateway keeping every send it is asked and answering each sent.
async fn sends(kept: Arc<Mutex<Vec<ChatSendRequest>>>) -> u16 {
  gateway(Router::new().route(
    "/sends",
    post(move |axum::Json(request): axum::Json<ChatSendRequest>| async move {
      kept.lock().expect("the sends are readable").push(request);
      (StatusCode::CREATED, axum::Json(json!({ "messageId": 1, "missed": [] })))
    }),
  ))
  .await
}

#[tokio::test]
async fn a_document_held_on_disk_goes_to_the_gateway_inline() {
  let file = Spooled::new("inline");
  std::fs::write(&file.0, b"a document").expect("the temporary directory takes a file");
  let kept = Arc::new(Mutex::new(Vec::new()));
  let provider = provider(true, sends(kept.clone()).await);

  let sent = provider.send(document(FileBody::stored(&file.0))).await;

  assert!(matches!(sent, Ok(ChatSendResult::Sent(_))), "{sent:?}");
  assert_eq!(
    kept.lock().expect("the sends are readable").as_slice(),
    [document(FileBody::Inline(b"a document".to_vec()))]
  );
}

#[tokio::test]
async fn a_document_over_the_file_limit_is_refused_without_the_gateway() {
  let file = Spooled::new("oversized");
  let limit = POLICY.dialect.file_bytes;
  // A sparse file: its size is past the limit while nothing of it is written.
  std::fs::File::create(&file.0)
    .and_then(|created| created.set_len(limit + 1))
    .expect("the temporary directory takes a file");

  let sent = provider(true, closed_port()).send(document(FileBody::stored(&file.0))).await;

  match sent {
    Ok(ChatSendResult::Refused(ChatRefusal::Platform { detail, .. })) => {
      assert_eq!(detail, format!("The file is {} bytes, and Discord takes at most {limit}.", limit + 1))
    }
    other => panic!("a refusal by size, not {other:?}"),
  }
}
