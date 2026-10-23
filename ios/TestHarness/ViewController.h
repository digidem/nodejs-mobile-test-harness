#import <UIKit/UIKit.h>

// The pbxproj still ships a Main.storyboard with IBOutlet/IBAction bindings
// inherited from the nodejs-mobile-samples original. We don't use the UI —
// the app exits as soon as node returns — but the storyboard will KVC-crash
// on launch if these properties/selectors aren't declared here.
@interface ViewController : UIViewController
@property (weak, nonatomic) IBOutlet UIButton *myButton;
@property (weak, nonatomic) IBOutlet UITextView *myTextView;
- (IBAction)myButtonAction:(id)sender;
@end
