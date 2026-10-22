import os
from tflite_support import metadata
from tflite_support import metadata_schema_py_generated as _metadata_fb

def add_metadata(model_path, label_path, output_path):
    print(f"Reading model from {model_path}...")
    with open(model_path, "rb") as f:
        model_buffer = f.read()

    # 1. Model Metadata
    model_meta = _metadata_fb.ModelMetadataT()
    model_meta.name = "PlasticBottleClassifier"
    model_meta.description = "Teachable Machine Image Classifier with NormalizationOptions metadata for MediaPipe"
    model_meta.version = "1.0"
    model_meta.author = "Teachable Machine"

    # 2. Input Tensor Metadata (Image input: 224x224x3 float32)
    input_meta = _metadata_fb.TensorMetadataT()
    input_meta.name = "image"
    input_meta.description = "Input image to be classified."
    input_meta.content = _metadata_fb.ContentT()
    input_meta.content.contentProperties = _metadata_fb.ImagePropertiesT()
    input_meta.content.contentProperties.colorSpace = _metadata_fb.ColorSpaceType.RGB
    input_meta.content.contentPropertiesType = _metadata_fb.ContentProperties.ImageProperties

    # Normalization options: Teachable Machine standard is mean=127.5, std=127.5 (maps 0..255 to -1..1)
    normalization = _metadata_fb.ProcessUnitT()
    normalization.optionsType = _metadata_fb.ProcessUnitOptions.NormalizationOptions
    normalization.options = _metadata_fb.NormalizationOptionsT()
    normalization.options.mean = [127.5]
    normalization.options.std = [127.5]
    input_meta.processUnits = [normalization]

    # 3. Output Tensor Metadata (Probabilities + Labels)
    output_meta = _metadata_fb.TensorMetadataT()
    output_meta.name = "probability"
    output_meta.description = "Probabilities of the 2 target classes."
    output_meta.content = _metadata_fb.ContentT()
    output_meta.content.contentProperties = _metadata_fb.FeaturePropertiesT()
    output_meta.content.contentPropertiesType = _metadata_fb.ContentProperties.FeatureProperties

    label_file = _metadata_fb.AssociatedFileT()
    label_file.name = os.path.basename(label_path)
    label_file.description = "Labels for categories"
    label_file.type = _metadata_fb.AssociatedFileType.TENSOR_AXIS_LABELS
    output_meta.associatedFiles = [label_file]

    # 4. Subgraph Metadata
    subgraph = _metadata_fb.SubGraphMetadataT()
    subgraph.inputTensorMetadata = [input_meta]
    subgraph.outputTensorMetadata = [output_meta]
    model_meta.subgraphMetadata = [subgraph]

    # 5. Pack metadata FlatBuffer
    b = _metadata_fb.flatbuffers.Builder(0)
    b.Finish(model_meta.Pack(b), b"M001")
    metadata_buf = b.Output()

    # 6. Populate metadata & associated label file into model
    populator = metadata.MetadataPopulator.with_model_buffer(model_buffer)
    populator.load_metadata_buffer(metadata_buf)
    populator.load_associated_files([label_path])
    populator.populate()

    updated_model_buf = populator.get_model_buffer()

    print(f"Writing updated model with NormalizationOptions to {output_path} ({len(updated_model_buf)} bytes)...")
    with open(output_path, "wb") as f:
        f.write(updated_model_buf)
    print("Metadata injection successful!")

if __name__ == "__main__":
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    model_in = os.path.join(base_dir, "public", "models", "model_unquant.tflite")
    labels = os.path.join(base_dir, "public", "models", "labels.txt")
    model_out = os.path.join(base_dir, "public", "models", "model_with_metadata.tflite")
    add_metadata(model_in, labels, model_out)
