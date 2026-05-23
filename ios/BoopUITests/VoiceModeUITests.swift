import XCTest

final class VoiceModeUITests: XCTestCase {
    func test_openVoiceMode_andDismiss() throws {
        let app = XCUIApplication()
        app.launchArguments += ["--ui-test-bypass-pairing"]
        app.launch()

        let mic = app.buttons["dock.voice"]
        guard mic.waitForExistence(timeout: 5) else {
            throw XCTSkip("dock.voice not reachable (likely needs pairing harness)")
        }
        mic.tap()

        // Expect either the orb or the permissions Allow button
        let orbExists = app.otherElements.matching(identifier: "voice.orb").firstMatch.waitForExistence(timeout: 5)
        let allowExists = app.buttons["Allow"].waitForExistence(timeout: 1)
        XCTAssertTrue(orbExists || allowExists)

        let exit = app.buttons["voice.exit.large"]
        if exit.waitForExistence(timeout: 3) { exit.tap() }
    }
}
