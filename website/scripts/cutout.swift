// Removes the background from product photos with the macOS Vision subject mask.
// Usage: swift scripts/cutout.swift <in> <out.png> [<in> <out.png> ...]
import CoreImage
import CoreImage.CIFilterBuiltins
import Foundation
import Vision

let args = CommandLine.arguments
let context = CIContext()
let colourSpace = CGColorSpace(name: CGColorSpace.sRGB)!
var index = 1
while index + 1 < args.count {
  let input = args[index]
  let output = args[index + 1]
  index += 2
  guard let image = CIImage(contentsOf: URL(fileURLWithPath: input)) else { print("load-failed \(input)"); continue }
  // Flatten onto white first so photos that already carry some transparency behave the same.
  let white = CIImage(color: .white).cropped(to: image.extent)
  let flat = image.composited(over: white)
  let handler = VNImageRequestHandler(ciImage: flat)
  let request = VNGenerateForegroundInstanceMaskRequest()
  do {
    try handler.perform([request])
    guard let result = request.results?.first else { print("no-subject \(input)"); continue }
    let mask = CIImage(cvPixelBuffer: try result.generateScaledMaskForImage(forInstances: result.allInstances, from: handler))
    let blend = CIFilter.blendWithMask()
    blend.inputImage = flat
    blend.maskImage = mask
    blend.backgroundImage = CIImage.empty()
    try context.writePNGRepresentation(of: blend.outputImage!.cropped(to: flat.extent), to: URL(fileURLWithPath: output), format: .RGBA8, colorSpace: colourSpace)
    print("ok \(output)")
  } catch { print("error \(input) \(error.localizedDescription)") }
}
