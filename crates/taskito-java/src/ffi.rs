//! JNI marshalling helpers and the panic-safety boundary.

use std::panic::{catch_unwind, AssertUnwindSafe};

use jni::objects::{JByteArray, JString};
use jni::JNIEnv;

use crate::error::BindingError;

/// Run `body`, converting both `BindingError`s and Rust panics into thrown Java
/// exceptions and returning `fallback` in either case.
///
/// A Rust panic must never unwind across the FFI boundary (undefined behaviour),
/// so every JNI entry point routes its work through this guard.
pub fn guard<'local, T>(
    env: &mut JNIEnv<'local>,
    fallback: T,
    body: impl FnOnce(&mut JNIEnv<'local>) -> Result<T, BindingError>,
) -> T {
    match catch_unwind(AssertUnwindSafe(|| body(env))) {
        Ok(Ok(value)) => value,
        Ok(Err(err)) => {
            err.throw(env);
            fallback
        }
        Err(_) => {
            BindingError::new("taskito native panic").throw(env);
            fallback
        }
    }
}

/// Read a required Java `String` argument into an owned Rust `String`.
pub fn read_string(env: &mut JNIEnv, value: &JString) -> Result<String, BindingError> {
    let java_str = env
        .get_string(value)
        .map_err(|e| BindingError::new(format!("invalid string argument: {e}")))?;
    Ok(java_str.into())
}

/// Read a Java `byte[]` argument into an owned `Vec<u8>`.
pub fn read_bytes(env: &mut JNIEnv, value: &JByteArray) -> Result<Vec<u8>, BindingError> {
    env.convert_byte_array(value)
        .map_err(|e| BindingError::new(format!("invalid byte[] argument: {e}")))
}

/// Build a Java `String` return value from an owned Rust `String`.
pub fn new_string(env: &mut JNIEnv, value: String) -> Result<jni::sys::jstring, BindingError> {
    env.new_string(value)
        .map(|s| s.into_raw())
        .map_err(|e| BindingError::new(format!("failed to allocate Java string: {e}")))
}
