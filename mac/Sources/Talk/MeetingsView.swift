import TalkCore
import SwiftUI

/// The meetings list. A meeting opens in the web app.
struct MeetingsView: View {
  @ObservedObject var model: AppModel

  var body: some View {
    Group {
      if !model.isSignedIn {
        ContentUnavailableView("Not signed in", systemImage: "person.crop.circle", description: Text("Sign in from Settings."))
      } else if let error = model.meetingsError, model.meetings.isEmpty {
        ContentUnavailableView {
          Label("Couldn't load meetings", systemImage: "exclamationmark.triangle")
        } description: {
          Text(error)
        } actions: {
          Button("Try Again") { Task { await model.loadMeetings() } }
        }
      } else if model.meetings.isEmpty && !model.loadingMeetings {
        ContentUnavailableView("No meetings yet", systemImage: "waveform", description: Text("Record one from the menu bar."))
      } else {
        List(model.meetings) { meeting in
          Button {
            model.open(meeting)
          } label: {
            MeetingRow(meeting: meeting)
          }
          .buttonStyle(.plain)
        }
      }
    }
    .frame(minWidth: 360, minHeight: 320)
    .toolbar {
      ToolbarItem {
        Button {
          Task { await model.loadMeetings() }
        } label: {
          Label("Refresh", systemImage: "arrow.clockwise")
        }
        .disabled(model.loadingMeetings)
      }
    }
    .task { await model.loadMeetings() }
  }
}

private struct MeetingRow: View {
  let meeting: MeetingSummary

  var body: some View {
    HStack {
      VStack(alignment: .leading, spacing: 2) {
        Text(meeting.title).lineLimit(1)
        if let date = meeting.startsAt {
          Text(date.formatted(date: .abbreviated, time: .shortened))
            .font(.caption)
            .foregroundStyle(.secondary)
        }
      }
      Spacer()
      if let status = meeting.status, status != "done" {
        Text(status.capitalized)
          .font(.caption)
          .foregroundStyle(status == "failed" ? .red : .secondary)
      }
      if meeting.visibility == "team" {
        Image(systemName: "person.2").foregroundStyle(.secondary).help("Shared with your team")
      }
      Image(systemName: "arrow.up.forward.square").foregroundStyle(.tertiary)
    }
    .padding(.vertical, 3)
    .contentShape(Rectangle())
  }
}
