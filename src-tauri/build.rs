fn main() {
    let manifest_dir = std::path::PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set"),
    );
    let credentials = manifest_dir.join("google_credentials.json");
    let fallback = manifest_dir.join("google_credentials.example.json");
    let source = if credentials.is_file() {
        &credentials
    } else {
        &fallback
    };
    let out = std::path::PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR is set"))
        .join("google_credentials.json");
    std::fs::copy(source, out).expect("copy Google credentials for compilation");
    println!("cargo:rerun-if-changed={}", credentials.display());
    println!("cargo:rerun-if-changed={}", fallback.display());
    tauri_build::build()
}
