package org.byteveda.taskito.serialization;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;
import org.byteveda.taskito.errors.SerializationException;

/** A {@link PayloadCodec} that gzip-compresses payloads. */
public final class GzipCodec implements PayloadCodec {

    @Override
    public byte[] encode(byte[] data) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (GZIPOutputStream gzip = new GZIPOutputStream(out)) {
            gzip.write(data);
        } catch (IOException e) {
            throw new SerializationException("gzip compression failed", e);
        }
        return out.toByteArray();
    }

    @Override
    public byte[] decode(byte[] data) {
        try (GZIPInputStream gzip = new GZIPInputStream(new ByteArrayInputStream(data))) {
            return gzip.readAllBytes();
        } catch (IOException e) {
            throw new SerializationException("gzip decompression failed", e);
        }
    }
}
