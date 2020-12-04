use crate::js::events::*;
use crate::js::session::SessionAction;
use crossbeam_channel as cc;
use indexer_base::progress::{IndexingProgress, IndexingResults};
use neon::{handle::Handle, prelude::*, types::JsString};
use processor::grabber::{GrabMetadata, Grabber, LineRange};
use std::thread;

type Channel<T> = (cc::Sender<T>, cc::Receiver<T>);

pub struct GrabberHolder {
    pub grabber: Grabber,
    pub handler: Option<EventHandler>,
    pub shutdown_channel: Channel<()>,
    pub event_channel: Channel<IndexingResults<()>>,
    pub metadata_channel: Channel<Option<GrabMetadata>>,
}
impl SessionAction for GrabberHolder {
    fn execute(
        &self,
        result_sender: cc::Sender<IndexingResults<()>>,
        shutdown_rx: Option<ShutdownReceiver>,
    ) -> Result<(), ComputationError> {
        match Grabber::create_metadata_for_file(
            self.grabber.path.clone(),
            &result_sender,
            shutdown_rx,
        ) {
            Ok(metadata) => {
                println!("RUST: constructed metadata, sending into channel");
                let _ = self.metadata_channel.0.send(metadata);
                Ok(())
            }
            Err(e) => {
                println!("Error during metadata creation: {}", e);
                Err(ComputationError::Communication(
                    "Could not create metadata".to_string(),
                ))
            }
        }
    }

    fn sync_computation(
        &mut self,
        start_line_index: u64,
        number_of_lines: u64,
    ) -> Result<Vec<String>, ComputationError> {
        println!("sync_computation 1");
        if self.grabber.metadata.is_none() {
            match self.metadata_channel.1.try_recv() {
                Err(cc::TryRecvError::Empty) => {
                    println!("RUST: metadata not initialized");
                }
                Err(e) => {
                    println!("RUST: Error: {}", e);
                }
                Ok(md) => {
                    println!("RUST: Received completed metadata");
                    self.grabber.metadata = md;
                }
            }
        }
        println!("sync_computation 2");
        self.grabber
            .get_entries(&LineRange::new(
                start_line_index as u64,
                start_line_index as u64 + number_of_lines as u64,
            ))
            .map_err(|e| ComputationError::Communication(format!("{}", e)))
    }
}

impl GrabberHolder {
    fn listen_for_progress_in_thread(
        progress_event_handler: neon::event::EventHandler,
        progress_receiver: cc::Receiver<IndexingResults<()>>,
    ) {
        thread::spawn(move || {
            println!("RUST: in progress listener thread");

            loop {
                match progress_receiver.recv() {
                    Ok(indexing_res) => match indexing_res {
                        Ok(progress) => match progress {
                            IndexingProgress::Stopped => {
                                println!("RUST: We were stopped");
                                break;
                            }
                            IndexingProgress::Finished => {
                                println!("RUST: We are finished");
                                break;
                            }
                            IndexingProgress::Progress { ticks } => {
                                let new_progress_percentage: u64 =
                                    (ticks.0 as f64 / ticks.1 as f64 * 100.0).round() as u64;
                                println!(
                                    "RUST: We made progress: {:.0?}%",
                                    new_progress_percentage
                                );
                                progress_event_handler.schedule_with(move |cx, this, callback| {
                                    let args: Vec<Handle<JsValue>> = vec![
                                        cx.string(CallbackEvent::Progress.to_string()).upcast(),
                                        cx.number(ticks.0 as f64).upcast(),
                                        cx.number(ticks.1 as f64).upcast(),
                                    ];
                                    if let Err(e) = callback.call(cx, this, args) {
                                        println!("Error on calling js callback: {}", e);
                                    }
                                });
                            }
                            IndexingProgress::GotItem { item } => {
                                println!("We got an item: {:?}", item);
                            }
                        },
                        Err(notification) => println!("got a notification: {:?}", notification),
                    },
                    Err(e) => println!("Error receiving progress: {}", e),
                }
            }
        });
    }
}

declare_types! {
    pub class JsGrabberHolder for GrabberHolder {
        init(mut cx) {
            println!("RUST: init of GrabberHolder");
            let path: Handle<JsString> = cx.argument::<JsString>(0)?;

            println!("RUST: init, path: {}", path.value());
            let shutdown_channel = cc::unbounded();
            let metadata_channel = cc::bounded(1);
            let chunk_result_channel: (cc::Sender<IndexingResults<()>>, cc::Receiver<IndexingResults<()>>) = cc::unbounded();
            match Grabber::lazy(path.value()) {
                Ok(grabber) => Ok(GrabberHolder {
                    grabber,
                    handler: None,
                    shutdown_channel,
                    metadata_channel,
                    event_channel: chunk_result_channel,
                }),
                Err(e) => {
                    cx.throw_error(format!("Error...{}", e))
                }
            }
        }

        constructor(mut cx) {
            println!("RUST: constructor of GrabberHolder");
            let mut this = cx.this();
            let f = cx.argument::<JsFunction>(1)?;
            let handler = EventHandler::new(&cx, this, f);
            {
                let guard = cx.lock();
                let mut this_mut = this.borrow_mut(&guard);
                this_mut.handler = Some(handler);
            }
            Ok(None)
        }

        method grab(mut cx) {
            let start_line_index: u64 = cx.argument::<JsNumber>(0)?.value() as u64;
            let number_of_lines: u64 = cx.argument::<JsNumber>(1)?.value() as u64;
            let mut this = cx.this();
            let array: Handle<JsArray> = JsArray::new(&mut cx, number_of_lines as u32);
            let r = cx.borrow_mut(&mut this, |mut grabber_holder| {
                if grabber_holder.grabber.metadata.is_none() {
                    match grabber_holder.metadata_channel.1.try_recv() {
                        Err(cc::TryRecvError::Empty) => {
                            println!("RUST: metadata not initialized");
                        }
                        Err(e) => {
                            println!("RUST: Error: {}", e);
                        }
                        Ok(md) => {
                            println!("RUST: Received completed metadata");
                            grabber_holder.grabber.metadata = md;
                        },
                    }
                }
                grabber_holder.grabber.get_entries(&LineRange::new(start_line_index, start_line_index + number_of_lines))
            });

            match r {
                Ok(lines) => {
                    for (i, x) in lines.into_iter().enumerate() {
                        let s = cx.string(x);
                        array.set(&mut cx, i as u32, s)?;
                    }
                    Ok(array.as_value(&mut cx))
                },
                Err(e) => cx.throw_error(format!("Error...{}", e))
            }
        }

        method start(mut cx) {
            println!("RUST: start");
            let this = cx.this();
            let (handler, grab_path, progress_sender, progress_receiver, shutdown_receiver, metadata_sender) = {
                let guard = cx.lock();
                let this = this.borrow(&guard);
                (this.handler.clone(),
                this.grabber.path.clone(),
                this.event_channel.0.clone(),
                this.event_channel.1.clone(),
                this.shutdown_channel.1.clone(),
                this.metadata_channel.0.clone())
            };
            if let Some(event_handler) = handler {
                let progress_event_handler = event_handler.clone();
                GrabberHolder::listen_for_progress_in_thread(progress_event_handler, progress_receiver);


                thread::spawn(move || {
                    println!("RUST: in new thread");
                     match Grabber::create_metadata_for_file(grab_path, &progress_sender, Some(shutdown_receiver)) {
                        Ok(metadata) => {
                            println!("RUST: constructed metadata, sending into channel");
                            let _ = metadata_sender.send(metadata);
                        }
                        Err(e) => {
                            println!("Error during metadata creation: {}", e);
                        }
                    }

                    event_handler.schedule_with(move |cx, this, callback| {
                        let args : Vec<Handle<JsValue>> = vec![cx.string(CallbackEvent::Done.to_string()).upcast()];
                        if let Err(e) = callback.call(cx, this, args) {
                            println!("Error on calling js callback: {}", e);
                        }
                    });
                });
            }
            Ok(cx.undefined().upcast())
        }

        method shutdown(mut cx) {
            println!("RUST: shutdown called, unregistering callback");
            let mut this = cx.this();
            {
                let guard = cx.lock();
                let mut callback = this.borrow_mut(&guard);
                callback.handler = None;
            }
            Ok(cx.undefined().upcast())
        }
    }
}
