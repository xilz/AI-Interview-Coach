import asyncio
import io
import wave
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from starlette.datastructures import UploadFile

import main


class UploadTranscriptionTests(unittest.TestCase):
    def run_upload(self, filename="recording.wav", payload=b"audio"):
        upload = UploadFile(filename=filename, file=io.BytesIO(payload))
        return asyncio.run(main.upload_interview(upload))

    def test_short_audio_returns_compatible_transcript(self):
        with tempfile.TemporaryDirectory() as directory:
            segment = Path(directory) / "short.wav"
            segment.write_bytes(b"wav")
            with patch.object(main, "_convert_and_split", return_value=[segment]), patch.object(
                main, "_transcribe_segment", return_value="你好"
            ):
                result = self.run_upload("../meeting.wav")
        self.assertEqual(result, {"filename": "meeting.wav", "transcript": "你好"})

    def test_real_wav_is_decoded_resampled_and_split(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "input.wav"
            output = Path(directory) / "segments"
            output.mkdir()
            with wave.open(str(source), "wb") as wav_file:
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)
                wav_file.setframerate(16_000)
                wav_file.writeframes(b"\x01\x00" * 32_000)
            with patch.object(main, "CHUNK_SECONDS", 1):
                segments = main._convert_and_split(source, output)
            self.assertEqual(len(segments), 2)
            with wave.open(str(segments[0]), "rb") as first_segment:
                self.assertEqual(first_segment.getframerate(), 16_000)
                self.assertEqual(first_segment.getnchannels(), 1)
                self.assertEqual(first_segment.getnframes(), 16_000)

    def test_long_audio_segments_are_merged_in_order(self):
        def segments(_source, directory):
            paths = [directory / "segment-1.wav", directory / "segment-2.wav"]
            for path in paths:
                path.write_bytes(b"wav")
            return paths

        with patch.object(main, "_convert_and_split", side_effect=segments), patch.object(
            main, "_transcribe_segment", side_effect=["第一段", "第二段"]
        ) as transcribe:
            result = self.run_upload()
        self.assertEqual(result["transcript"], "第一段\n第二段")
        self.assertEqual(transcribe.call_count, 2)

    def test_all_empty_asr_segments_are_rejected_with_segment_number(self):
        def segments(_source, directory):
            path = directory / "segment-1.wav"
            path.write_bytes(b"wav")
            return [path]

        with patch.object(main, "_convert_and_split", side_effect=segments), patch.object(
            main, "_transcribe_segment", return_value="  \n "
        ):
            result = self.run_upload()
        self.assertEqual(result.status_code, 502)
        self.assertIn("第 1 段", result.body.decode())
        self.assertIn("有效转录文本", result.body.decode())
        self.assertNotIn(b'"transcript"', result.body)

    def test_empty_segment_list_cannot_return_successful_empty_transcript(self):
        with patch.object(main, "_convert_and_split", return_value=[]), patch.object(
            main, "_transcribe_segment"
        ) as transcribe:
            result = self.run_upload()
        self.assertEqual(result.status_code, 422)
        self.assertIn("未识别到有效语音文本", result.body.decode())
        transcribe.assert_not_called()

    def test_invalid_audio_returns_client_error(self):
        with patch.object(main, "_convert_and_split", side_effect=main.AudioProcessingError("无效音频")):
            result = self.run_upload()
        self.assertEqual(result.status_code, 400)
        self.assertIn("无效音频", result.body.decode())

    def test_asr_failure_identifies_segment(self):
        def segments(_source, directory):
            paths = [directory / "segment-1.wav", directory / "segment-2.wav"]
            for path in paths:
                path.write_bytes(b"wav")
            return paths

        with patch.object(main, "_convert_and_split", side_effect=segments), patch.object(
            main, "_transcribe_segment", side_effect=["第一段", RuntimeError("provider unavailable")]
        ):
            result = self.run_upload()
        self.assertEqual(result.status_code, 502)
        self.assertIn("第 2 段", result.body.decode())
        self.assertNotIn(b'"transcript"', result.body)

    def test_upload_logs_segment_and_total_duration_without_transcript(self):
        def segments(_source, directory):
            path = directory / "segment-1.wav"
            path.write_bytes(b"wav")
            return [path]

        with patch.object(main, "_convert_and_split", side_effect=segments), patch.object(
            main, "_transcribe_segment", return_value="private transcript"
        ), self.assertLogs(main.logger, level="INFO") as captured:
            result = self.run_upload()

        self.assertEqual(result["transcript"], "private transcript")
        logs = "\n".join(captured.output)
        self.assertIn("ASR segment=1/1 status=started", logs)
        self.assertIn("ASR segment=1/1 status=success duration_ms=", logs)
        self.assertIn("Upload/transcription status=success duration_ms=", logs)
        self.assertNotIn("private transcript", logs)


if __name__ == "__main__":
    unittest.main()
